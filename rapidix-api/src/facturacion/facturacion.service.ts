import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EstadoFactura, ModoTimbrado, OrigenCupon, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  aGuardado,
  armarComprobante,
  bloqueoDeFacturacion,
  ClavesSat,
  ConceptoGuardado,
  totalFacturado,
} from './comprobante';
import {
  incompatibilidad,
  REGIMENES_FISCALES,
  RegimenFiscal,
  USOS_CFDI,
  UsoCfdi,
} from './catalogos-sat';
import { DatosFiscalesDto, FacturarPedidoDto } from './dto/factura.dto';
import { CatalogoSatService, FormaPagoSat } from './catalogo-sat.service';
import {
  FacturaTimbrada,
  ProveedorNoDisponible,
  Receptor,
  Timbrador,
  TimbradoRechazado,
} from './timbrador';
import { TimbradorSimulado } from './timbrador-simulado';
import { configFacturaComDesdeEntorno, TimbradorFacturaCom } from './timbrador-factura-com';

const Decimal = Prisma.Decimal;

/**
 * Cuanto se respeta una reserva TIMBRANDO. Pasado este tiempo se da por
 * abandonada (la API se reinicio a media llamada) y se deja reintentar.
 */
const VIGENCIA_RESERVA_MS = 2 * 60_000;

export interface FacturaDto {
  uuid: string;
  modo: ModoTimbrado;
  serie: string | null;
  folio: string | null;
  rfc: string;
  razonSocial: string;
  total: number;
  timbradaEn: string;
}

export interface DatosFiscalesRespuesta {
  /** Lo guardado la ultima vez, para pre-llenar. `null` si nunca guardo nada. */
  datos: (Omit<DatosFiscalesDto, 'email'> & { email: string | null }) | null;
  /**
   * El correo con el que pre-llenar cuando todavia no hay datos guardados: el
   * de su perfil. El correo es obligatorio y casi siempre es ese.
   */
  emailSugerido: string | null;
  regimenes: RegimenFiscal[];
  usos: UsoCfdi[];
  /**
   * c_FormaPago del SAT, para «Facturar». No se guarda con los datos fiscales:
   * es de cada pedido, y llega ya elegida en `PedidoDto.formaPagoFactura`.
   */
  formasPago: FormaPagoSat[];
  /** SIMULADO mientras no haya llaves: la interfaz avisa que no tiene validez. */
  modo: ModoTimbrado;
}

export interface DocumentoFactura {
  contenido: Buffer;
  nombre: string;
  tipo: string;
}

@Injectable()
export class FacturacionService implements OnModuleInit {
  private readonly logger = new Logger(FacturacionService.name);
  private readonly simulado = new TimbradorSimulado();
  private readonly facturaCom: TimbradorFacturaCom | null;
  private readonly claves: ClavesSat = {
    // 01010101 «No existe en el catalogo» lo acepta el SAT para cualquier
    // producto; el contador puede pedir claves mas finas.
    producto: process.env.FACTURACION_CLAVE_PRODUCTO?.trim() || '01010101',
    // 78102203 «Servicios de envio, recogida o entrega de correo».
    servicio: process.env.FACTURACION_CLAVE_SERVICIO?.trim() || '78102203',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogoSat: CatalogoSatService,
  ) {
    const config = configFacturaComDesdeEntorno();
    this.facturaCom = config ? new TimbradorFacturaCom(config) : null;
  }

  onModuleInit(): void {
    if (this.facturaCom) {
      const entorno = configFacturaComDesdeEntorno()?.sandbox ? 'sandbox' : 'PRODUCCION';
      this.logger.log(`Facturacion con factura.com (${entorno})`);
    } else {
      this.logger.warn(
        'Facturacion en modo SIMULADO: sin FACTURACOM_API_KEY/SECRET_KEY/SERIE los CFDI ' +
          'llevan un folio inventado y no tienen validez fiscal.',
      );
    }
  }

  /** Con lo que se timbra hoy. Una factura ya timbrada se sirve con el suyo. */
  private get timbrador(): Timbrador {
    return this.facturaCom ?? this.simulado;
  }

  // ----------------------------------------------------------------
  // Datos fiscales del cliente
  // ----------------------------------------------------------------

  async datosFiscales(duenioId: string): Promise<DatosFiscalesRespuesta> {
    // Un prospecto no tiene fila en `clientes` ni nada guardado: el formulario
    // simplemente sale vacio.
    const cliente = await this.prisma.cliente.findUnique({
      where: { id: duenioId },
      select: {
        rfc: true,
        razonSocial: true,
        regimenFiscal: true,
        usoCfdi: true,
        cpFiscal: true,
        emailFacturacion: true,
        email: true,
      },
    });
    const completos =
      cliente?.rfc &&
      cliente.razonSocial &&
      cliente.regimenFiscal &&
      cliente.usoCfdi &&
      cliente.cpFiscal;
    return {
      datos: completos
        ? {
            rfc: cliente.rfc!,
            razonSocial: cliente.razonSocial!,
            regimenFiscal: cliente.regimenFiscal!,
            usoCfdi: cliente.usoCfdi!,
            cpFiscal: cliente.cpFiscal!,
            email: cliente.emailFacturacion ?? cliente.email,
          }
        : null,
      emailSugerido: cliente?.emailFacturacion ?? cliente?.email ?? null,
      regimenes: REGIMENES_FISCALES,
      usos: USOS_CFDI,
      formasPago: this.catalogoSat.formasDePago(),
      modo: this.timbrador.modo,
    };
  }

  async guardarDatosFiscales(
    duenioId: string,
    dto: DatosFiscalesDto,
  ): Promise<DatosFiscalesRespuesta> {
    this.exigirCompatibles(dto);
    const actualizados = await this.prisma.cliente.updateMany({
      where: { id: duenioId },
      data: this.columnasFiscales(dto),
    });
    if (actualizados.count === 0) {
      throw new ConflictException({
        statusCode: 409,
        code: 'SIN_COMPRAS',
        message: 'Podrás guardar tus datos de facturación después de tu primera compra.',
      });
    }
    return this.datosFiscales(duenioId);
  }

  // ----------------------------------------------------------------
  // Timbrado
  // ----------------------------------------------------------------

  /**
   * Boton «Facturar» de Mis pedidos. Los candados van en este orden y aqui,
   * no en el boton: un POST a mano se salta la interfaz.
   *
   *  1. El pedido es de quien pregunta (404 si no: no se confirma que exista).
   *  2. No tiene ya un CFDI (409 YA_FACTURADO) ni uno timbrandose (409).
   *  3. Esta pagado (409 con el `code` del bloqueo).
   *  4. Los datos fiscales no se contradicen y la forma de pago esta en el
   *     catalogo (400).
   *  5. Los conceptos cuadran con el total cobrado (409 FACTURA_NO_CUADRA).
   *  6. Se reserva la fila y se timbra; si el proveedor rechaza, la reserva
   *     se borra y el cliente puede corregir y reintentar (422 / 502).
   */
  async facturar(clienteId: string, pedidoId: string, dto: FacturarPedidoDto): Promise<FacturaDto> {
    const pedido = await this.prisma.pedido.findFirst({
      where: { id: pedidoId, clienteId },
      include: {
        items: { include: { producto: { select: { claveProdServ: true, claveUnidad: true } } } },
        cupon: { select: { sourceKind: true, sourceCode: true } },
        factura: { select: { id: true, estado: true, uuid: true, creadoEn: true } },
      },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    if (pedido.factura) {
      if (pedido.factura.estado === EstadoFactura.TIMBRADA) {
        throw new ConflictException({
          statusCode: 409,
          code: 'YA_FACTURADO',
          message: `Este pedido ya está facturado (folio fiscal ${pedido.factura.uuid}).`,
        });
      }
      if (Date.now() - pedido.factura.creadoEn.getTime() < VIGENCIA_RESERVA_MS) {
        throw new ConflictException({
          statusCode: 409,
          code: 'TIMBRADO_EN_CURSO',
          message: 'Ya estamos timbrando la factura de este pedido. Espera un momento.',
        });
      }
      // Reserva abandonada. Solo se borra si sigue igual: si otra peticion la
      // acaba de completar, `count` sale en cero y el create de abajo choca.
      await this.prisma.factura.deleteMany({
        where: { id: pedido.factura.id, estado: EstadoFactura.TIMBRANDO },
      });
    }

    const bloqueo = bloqueoDeFacturacion(pedido);
    if (bloqueo) {
      throw new ConflictException({
        statusCode: 409,
        code: bloqueo.codigo,
        message: bloqueo.mensaje,
      });
    }
    this.exigirCompatibles(dto);
    if (dto.formaPago !== undefined && !this.catalogoSat.formaDePagoValida(dto.formaPago)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'FORMA_PAGO_INVALIDA',
        message: 'Esa forma de pago no está en el catálogo del SAT para facturas ya pagadas.',
      });
    }

    const comprobante = armarComprobante(
      {
        ...pedido,
        // Las claves del SAT se leen del producto de hoy, no del renglon: no
        // mueven dinero y corregirlas tiene que alcanzar a lo no facturado.
        items: pedido.items.map((i) => ({
          ...i,
          claveProdServ: i.producto.claveProdServ,
          claveUnidad: this.unidadSat(i.producto.claveUnidad),
        })),
      },
      await this.categoriasDelCupon(pedido.cupon),
      this.claves,
    );
    // La factura va por el total del pedido, monedero incluido, redondeado al
    // peso (`totalFacturado`). Sin ningun producto al 0 % el desglose puede
    // quedar a un centavo de el (`armarComprobante`): eso se acepta. Mas que
    // eso es que el pedido tiene columnas que no suman, y un CFDI timbrado no
    // se puede deshacer.
    const esperado = totalFacturado(pedido.total);
    if (comprobante.total.sub(esperado).abs().greaterThan(new Decimal('0.01'))) {
      this.logger.error(
        `El pedido ${pedido.folio} no cuadra para facturar: se esperaba ${esperado.toFixed(2)} ` +
          `(total ${pedido.total.toFixed(2)}), conceptos ${comprobante.total.toFixed(2)}`,
      );
      throw new ConflictException({
        statusCode: 409,
        code: 'FACTURA_NO_CUADRA',
        message: 'No pudimos armar la factura de este pedido. Escríbenos y la emitimos a mano.',
      });
    }
    if (!comprobante.total.greaterThan(0)) {
      throw new ConflictException({
        statusCode: 409,
        code: 'FACTURA_SIN_IMPORTE',
        message: 'Este pedido no tiene importe que facturar.',
      });
    }

    // El cliente puede corregir la forma de pago que Rapidix dedujo del pedido
    // (pago con tarjeta en la terminal, por ejemplo, queda como efectivo).
    if (dto.formaPago) comprobante.formaPago = dto.formaPago;

    const receptor: Receptor = {
      rfc: dto.rfc,
      razonSocial: dto.razonSocial,
      regimenFiscal: dto.regimenFiscal,
      usoCfdi: dto.usoCfdi,
      cpFiscal: dto.cpFiscal,
      email: dto.email,
    };
    const conceptos = comprobante.conceptos.map(aGuardado);
    const timbrador = this.timbrador;

    let reservaId: string;
    try {
      const reserva = await this.prisma.factura.create({
        data: {
          pedidoId,
          clienteId,
          modo: timbrador.modo,
          ...receptor,
          formaPago: comprobante.formaPago,
          subtotal: comprobante.subtotal,
          descuento: comprobante.descuento,
          iva: comprobante.iva,
          total: comprobante.total,
          conceptos: conceptos as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      reservaId = reserva.id;
    } catch (fallo) {
      if (fallo instanceof Prisma.PrismaClientKnownRequestError && fallo.code === 'P2002') {
        throw new ConflictException({
          statusCode: 409,
          code: 'TIMBRADO_EN_CURSO',
          message: 'Ya estamos timbrando la factura de este pedido. Espera un momento.',
        });
      }
      throw fallo;
    }

    // Dos `try` separados a proposito: un timbre rechazado se deshace y se
    // reintenta; un timbre bueno que no se pudo guardar es otro problema.
    let timbrado;
    try {
      timbrado = await timbrador.timbrar({
        folioPedido: pedido.folio,
        receptor,
        conceptos,
        formaPago: comprobante.formaPago,
      });
    } catch (fallo) {
      await this.prisma.factura.delete({ where: { id: reservaId } }).catch((e: unknown) => {
        this.logger.error(`No se pudo soltar la reserva de factura ${reservaId}`, String(e));
      });
      throw this.traducirFallo(fallo, pedido.folio);
    }

    let factura;
    try {
      factura = await this.prisma.factura.update({
        where: { id: reservaId },
        data: {
          estado: EstadoFactura.TIMBRADA,
          uuid: timbrado.uuid,
          proveedorId: timbrado.proveedorId,
          serie: timbrado.serie,
          folio: timbrado.folio,
          respuesta: timbrado.respuesta,
          timbradaEn: new Date(),
        },
      });
    } catch (fallo) {
      // El CFDI ya existe ante el SAT. Se deja todo en el log para darlo de
      // alta a mano; la reserva queda y bloquea un segundo timbre.
      this.logger.error(
        `CFDI ${timbrado.uuid} del pedido ${pedido.folio} timbrado pero NO guardado`,
        JSON.stringify({ timbrado, error: String(fallo) }),
      );
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'FACTURA_SIN_GUARDAR',
        message: `Tu factura se timbró (folio fiscal ${timbrado.uuid}) pero no pudimos guardarla. Escríbenos con este folio.`,
      });
    }

    if (dto.guardarDatos) {
      // Comodidad, no parte de la factura: si falla, la factura sigue valiendo.
      await this.prisma.cliente
        .update({ where: { id: clienteId }, data: this.columnasFiscales(dto) })
        .catch((e: unknown) =>
          this.logger.warn(`No se guardaron los datos fiscales: ${String(e)}`),
        );
    }

    return {
      uuid: factura.uuid!,
      modo: factura.modo,
      serie: factura.serie,
      folio: factura.folio,
      rfc: factura.rfc,
      razonSocial: factura.razonSocial,
      total: factura.total.toNumber(),
      timbradaEn: factura.timbradaEn!.toISOString(),
    };
  }

  /**
   * PDF o XML de la factura de un pedido del cliente.
   *
   * Lo sirve el mismo modo que la timbro: una factura simulada sigue siendo
   * simulada aunque despues se pongan las llaves de factura.com.
   */
  async documento(
    clienteId: string,
    pedidoId: string,
    formato: 'pdf' | 'xml',
  ): Promise<DocumentoFactura> {
    const factura = await this.prisma.factura.findFirst({
      where: { pedidoId, clienteId, estado: EstadoFactura.TIMBRADA },
      include: { pedido: { select: { folio: true } } },
    });
    if (!factura) throw new NotFoundException('Este pedido no tiene factura');

    const timbrador = factura.modo === ModoTimbrado.SIMULADO ? this.simulado : this.facturaCom;
    if (!timbrador) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'PROVEEDOR_NO_CONFIGURADO',
        message: 'La facturación no está disponible en este momento.',
      });
    }

    const timbrada: FacturaTimbrada = {
      rfc: factura.rfc,
      razonSocial: factura.razonSocial,
      regimenFiscal: factura.regimenFiscal,
      usoCfdi: factura.usoCfdi,
      cpFiscal: factura.cpFiscal,
      email: factura.email,
      uuid: factura.uuid!,
      proveedorId: factura.proveedorId,
      serie: factura.serie,
      folio: factura.folio,
      formaPago: factura.formaPago,
      subtotal: factura.subtotal,
      descuento: factura.descuento,
      iva: factura.iva,
      total: factura.total,
      conceptos: factura.conceptos as unknown as ConceptoGuardado[],
      timbradaEn: factura.timbradaEn!,
      folioPedido: factura.pedido.folio,
    };

    try {
      const contenido =
        formato === 'pdf' ? await timbrador.pdf(timbrada) : await timbrador.xml(timbrada);
      return {
        contenido,
        nombre: `factura-${factura.pedido.folio}.${formato}`,
        tipo: formato === 'pdf' ? 'application/pdf' : 'application/xml',
      };
    } catch (fallo) {
      throw this.traducirFallo(fallo, factura.pedido.folio);
    }
  }

  /**
   * El cliente de un pedido, para que Finanzas facture a su nombre: los datos
   * fiscales, el CFDI y sus archivos son del cliente, no de quien pulsa.
   */
  async clienteDelPedido(pedidoId: string): Promise<string> {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      select: { clienteId: true },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    return pedido.clienteId;
  }

  // ----------------------------------------------------------------
  // Ayudas
  // ----------------------------------------------------------------

  /**
   * La clave de unidad con el nombre que la acompania en el CFDI. Una clave
   * que el catalogo ya no trae (el SAT la dio de baja) se ignora y la unidad
   * se deduce del texto, que es lo que pasaria sin clave.
   */
  private unidadSat(clave: string | null): { clave: string; nombre: string } | null {
    if (!clave) return null;
    const unidad = this.catalogoSat.unidad(clave);
    return unidad ? { clave: unidad.clave, nombre: unidad.nombre } : null;
  }

  private exigirCompatibles(dto: DatosFiscalesDto): void {
    const motivo = incompatibilidad(dto);
    if (motivo) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'DATOS_FISCALES_INCOMPATIBLES',
        message: motivo,
      });
    }
  }

  private columnasFiscales(dto: DatosFiscalesDto): Prisma.ClienteUpdateInput {
    return {
      rfc: dto.rfc,
      razonSocial: dto.razonSocial,
      regimenFiscal: dto.regimenFiscal,
      usoCfdi: dto.usoCfdi,
      cpFiscal: dto.cpFiscal,
      emailFacturacion: dto.email,
    };
  }

  /**
   * Las categorias a las que estaba atado el cupon. Las condiciones del cupon
   * emitido no guardan las de su campania, asi que se leen de ella; si la
   * campania ya no existe, el descuento se reparte en todo el pedido.
   */
  private async categoriasDelCupon(
    cupon: { sourceKind: OrigenCupon; sourceCode: string } | null,
  ): Promise<string[]> {
    if (cupon?.sourceKind !== OrigenCupon.CAMPAIGN) return [];
    const campania = await this.prisma.campania.findUnique({
      where: { name: cupon.sourceCode },
      select: { categorias: true },
    });
    return campania?.categorias ?? [];
  }

  private traducirFallo(fallo: unknown, folio: string): Error {
    if (fallo instanceof TimbradoRechazado) {
      this.logger.warn(`Timbrado rechazado para ${folio}: ${fallo.message}`);
      return new UnprocessableEntityException({
        statusCode: 422,
        code: 'TIMBRADO_RECHAZADO',
        message: fallo.message,
      });
    }
    if (fallo instanceof ProveedorNoDisponible) {
      this.logger.error(`Proveedor de facturacion no disponible (${folio}): ${fallo.message}`);
      return new BadGatewayException({
        statusCode: 502,
        code: 'PROVEEDOR_NO_DISPONIBLE',
        message: 'No pudimos conectar con el servicio de facturación. Inténtalo en unos minutos.',
      });
    }
    return fallo instanceof Error ? fallo : new Error(String(fallo));
  }
}
