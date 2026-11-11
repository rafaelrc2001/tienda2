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
import { EstadoFactura, ModoTimbrado, OrigenCupon, Prisma, TasaIva } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import {
  aGuardado,
  armarComprobante,
  bloqueoDeFacturacion,
  ClavesSat,
  Comprobante,
  ConceptoGuardado,
  retieneIsrResico,
  totalAFacturar,
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
import { emisorDesdeEntorno, TimbradorSimulado } from './timbrador-simulado';
import { configFacturaComDesdeEntorno, TimbradorFacturaCom } from './timbrador-factura-com';
import { EmisorElegido, EmisorService } from './emisor.service';

const Decimal = Prisma.Decimal;

/**
 * Cuanto se respeta una reserva TIMBRANDO. Pasado este tiempo se da por
 * abandonada (la API se reinicio a media llamada) y se deja reintentar.
 */
const VIGENCIA_RESERVA_MS = 2 * 60_000;

/** Lo que se lee de cada pedido para facturarlo. */
const INCLUIR_FACTURABLE = {
  items: {
    include: { producto: { select: { claveProdServ: true, claveUnidad: true, tasaIva: true } } },
  },
  cupon: { select: { sourceKind: true, sourceCode: true } },
  factura: { select: { id: true, estado: true, uuid: true } },
} satisfies Prisma.PedidoInclude;

export type PedidoFacturable = Prisma.PedidoGetPayload<{ include: typeof INCLUIR_FACTURABLE }>;

/** Lo que se lee de una factura para volver a servir sus archivos. */
const INCLUIR_DOCUMENTO = {
  pedidos: { select: { folio: true }, orderBy: { folio: 'asc' } },
} satisfies Prisma.FacturaInclude;

type FacturaConPedidos = Prisma.FacturaGetPayload<{ include: typeof INCLUIR_DOCUMENTO }>;

/** Quien pide la factura: se congela en ella con su nombre, como en la bitacora. */
export interface AutorFactura {
  id: string;
  nombre: string;
  rol: string;
}

export function autorDe(usuario: UsuarioAutenticado): AutorFactura {
  return { id: usuario.sub, nombre: usuario.nombre, rol: usuario.rol };
}

export interface FacturaDto {
  id: string;
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

/** El emisor: la razon social con la que se timbra. */
export interface EmisorVistaDto {
  rfc: string | null;
  nombre: string | null;
  regimen: string | null;
  cp: string | null;
}

export interface ConceptoVistaDto {
  descripcion: string;
  claveProdServ: string;
  claveUnidad: string;
  unidad: string;
  cantidad: number;
  /** Sin IVA, con los seis decimales que admite el SAT. */
  valorUnitario: string;
  importe: number;
  descuento: number;
  tasaIva: TasaIva;
  iva: number;
  retencionIsr: number;
}

/** `POST .../factura/vista-previa`: el CFDI tal como se mandaria a timbrar. */
export interface VistaFacturaDto {
  modo: ModoTimbrado;
  emisor: EmisorVistaDto;
  receptor: Receptor;
  formaPago: string;
  metodoPago: 'PUE';
  conceptos: ConceptoVistaDto[];
  subtotal: number;
  descuento: number;
  iva: number;
  /** ISR retenido: RESICO que le factura a una persona moral. Si no, cero. */
  retencionIsr: number;
  /** subtotal - descuento + iva - retencionIsr. */
  total: number;
}

export interface DocumentoFactura {
  contenido: Buffer;
  nombre: string;
  tipo: string;
}

/** El CFDI ya armado, listo para enseñarse o timbrarse: lo mismo en los dos. */
export interface FacturaPreparada {
  pedidos: PedidoFacturable[];
  emisor: EmisorElegido;
  receptor: Receptor;
  comprobante: Comprobante;
}

@Injectable()
export class FacturacionService implements OnModuleInit {
  private readonly logger = new Logger(FacturacionService.name);
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
    private readonly emisores: EmisorService,
  ) {}

  onModuleInit(): void {
    const config = configFacturaComDesdeEntorno();
    if (config) {
      const entorno = config.sandbox ? 'sandbox' : 'PRODUCCION';
      this.logger.log(
        `Llaves de factura.com en el entorno (${entorno}): toda factura sale con esa cuenta`,
      );
    } else {
      this.logger.warn(
        'Sin FACTURACOM_API_KEY/SECRET_KEY/SERIE: se factura en modo SIMULADO ' +
          '(folio inventado, sin validez fiscal).',
      );
    }
  }

  /**
   * Con que se timbra con ese emisor: factura.com si tiene llaves, si no
   * simulado, con el emisor de pruebas del entorno.
   */
  timbradorPara(emisor: EmisorElegido): Timbrador {
    return emisor.facturaCom
      ? new TimbradorFacturaCom(emisor.facturaCom)
      : new TimbradorSimulado(emisorDesdeEntorno());
  }

  /** El aviso de «modo demostracion» de Mis pedidos y Finanzas. */
  modoPrincipal(): ModoTimbrado {
    return this.emisores.modo();
  }

  /**
   * El timbrador con el que se timbro una factura, para servir sus archivos.
   * Una simulada sigue siendo simulada aunque despues se pongan las llaves, y
   * sale con el emisor con el que se timbro (el del entorno si es de antes de
   * que se congelara). Una de factura.com se pide con las llaves con que se
   * timbro: las del servidor, o las propias de su razon social si es de antes.
   */
  async timbradorDeFactura(factura: {
    modo: ModoTimbrado;
    razonSocialId: string | null;
    emisor: { rfc: string; nombre: string; regimen: string; cp: string } | null;
  }): Promise<Timbrador> {
    if (factura.modo === ModoTimbrado.SIMULADO) {
      return new TimbradorSimulado(factura.emisor ?? emisorDesdeEntorno());
    }
    const llaves = await this.emisores.llavesParaDocumentos(factura.razonSocialId);
    if (!llaves) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'PROVEEDOR_NO_CONFIGURADO',
        message: 'La facturación no está disponible en este momento.',
      });
    }
    return new TimbradorFacturaCom(llaves);
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
      modo: this.modoPrincipal(),
    };
  }

  async guardarDatosFiscales(
    duenioId: string,
    dto: DatosFiscalesDto,
  ): Promise<DatosFiscalesRespuesta> {
    this.exigirCompatibles(dto);
    const actualizados = await this.prisma.cliente.updateMany({
      where: { id: duenioId },
      data: FacturacionService.columnasFiscales(dto),
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
  // Un pedido: Mis pedidos y Finanzas, con la razon social principal
  // ----------------------------------------------------------------

  /**
   * Lo que se mandaria a timbrar, sin timbrar: la hoja «Facturar» lo ensena
   * antes de confirmar. Pasa por los mismos candados que `facturar`.
   */
  async previsualizar(
    clienteId: string,
    pedidoId: string,
    dto: FacturarPedidoDto,
  ): Promise<VistaFacturaDto> {
    const pedidos = await this.cargarFacturables([pedidoId], { clienteId });
    return this.vista(await this.preparar(pedidos, dto, await this.emisores.actual()));
  }

  /**
   * Boton «Facturar» de Mis pedidos (y de Finanzas, a nombre del cliente). Los
   * candados van en este orden y aqui, no en el boton: un POST a mano se salta
   * la interfaz.
   *
   *  1. El pedido es de quien pregunta (404 si no: no se confirma que exista).
   *  2. No tiene ya un CFDI (409 YA_FACTURADO) ni uno timbrandose (409
   *     TIMBRADO_EN_CURSO).
   *  3. Esta pagado (409 con el `code` del bloqueo).
   *  4. Los datos fiscales no se contradicen y la forma de pago esta en el
   *     catalogo (400).
   *  5. Los conceptos cuadran con el total cobrado (409 FACTURA_NO_CUADRA).
   *  6. Se reserva la factura y se timbra; si el proveedor rechaza, la reserva
   *     se borra y el cliente puede corregir y reintentar (422 / 502).
   */
  async facturar(
    clienteId: string,
    pedidoId: string,
    dto: FacturarPedidoDto,
    autor: AutorFactura,
  ): Promise<FacturaDto> {
    const pedidos = await this.cargarFacturables([pedidoId], { clienteId });
    const preparada = await this.preparar(pedidos, dto, await this.emisores.actual());
    const factura = await this.timbrar(preparada, autor);

    if (dto.guardarDatos) {
      // Comodidad, no parte de la factura: si falla, la factura sigue valiendo.
      await this.prisma.cliente
        .update({ where: { id: clienteId }, data: FacturacionService.columnasFiscales(dto) })
        .catch((e: unknown) =>
          this.logger.warn(`No se guardaron los datos fiscales: ${String(e)}`),
        );
    }
    return factura;
  }

  // ----------------------------------------------------------------
  // Uno o varios pedidos: lo que comparten todas las facturas
  // ----------------------------------------------------------------

  /**
   * Los pedidos a facturar, en orden de folio. 404 si alguno no existe o no
   * cumple `donde` (no es de quien pregunta, no es de esa tienda): no se
   * confirma que exista.
   *
   * Antes de leerlos se borran las reservas abandonadas (la API se reinicio a
   * media llamada), que sueltan sus pedidos al borrarse.
   */
  async cargarFacturables(
    pedidoIds: string[],
    donde: Prisma.PedidoWhereInput = {},
  ): Promise<PedidoFacturable[]> {
    await this.prisma.factura.deleteMany({
      where: {
        estado: EstadoFactura.TIMBRANDO,
        creadoEn: { lt: new Date(Date.now() - VIGENCIA_RESERVA_MS) },
      },
    });
    const ids = [...new Set(pedidoIds)];
    const pedidos = await this.prisma.pedido.findMany({
      where: { AND: [{ id: { in: ids } }, donde] },
      include: INCLUIR_FACTURABLE,
      orderBy: { folio: 'asc' },
    });
    if (pedidos.length !== ids.length) {
      throw new NotFoundException(
        ids.length === 1 ? 'Pedido no encontrado' : 'Alguno de los pedidos no se encontró.',
      );
    }
    return pedidos;
  }

  /**
   * Por que alguno de los pedidos no se puede facturar, como el error que se
   * lanza. Con varios, el mensaje dice cual.
   */
  exigirFacturables(pedidos: PedidoFacturable[]): void {
    const varios = pedidos.length > 1;
    for (const pedido of pedidos) {
      const de = varios ? `${pedido.folio}: ` : '';
      if (pedido.factura?.estado === EstadoFactura.TIMBRADA) {
        throw new ConflictException({
          statusCode: 409,
          code: 'YA_FACTURADO',
          message: varios
            ? `El pedido ${pedido.folio} ya está facturado (folio fiscal ${pedido.factura.uuid}).`
            : `Este pedido ya está facturado (folio fiscal ${pedido.factura.uuid}).`,
        });
      }
      // Las abandonadas ya se borraron: esta es de hace un momento.
      if (pedido.factura) {
        throw new ConflictException({
          statusCode: 409,
          code: 'TIMBRADO_EN_CURSO',
          message: varios
            ? `Ya se está timbrando una factura del pedido ${pedido.folio}. Espera un momento.`
            : 'Ya estamos timbrando la factura de este pedido. Espera un momento.',
        });
      }
      const bloqueo = bloqueoDeFacturacion(pedido);
      if (bloqueo) {
        throw new ConflictException({
          statusCode: 409,
          code: bloqueo.codigo,
          message: `${de}${bloqueo.mensaje}`,
        });
      }
      const sinIva = ivaSinConfigurar(pedido.items);
      if (sinIva) {
        throw new ConflictException({
          statusCode: 409,
          code: 'IVA_SIN_CONFIGURAR',
          message: `${de}${sinIva}`,
        });
      }
    }
  }

  /**
   * Lo que comparten la vista previa y el timbre, para que lo que se ensena
   * sea lo que se timbra: candados, conceptos cuadrados y retencion.
   *
   * Con varios pedidos cada uno se arma y se cuadra por su lado —exactamente
   * como si se facturara solo— y la factura junta sus conceptos. Cada concepto
   * lleva el folio de su pedido para que se sepa de donde salio.
   */
  async preparar(
    pedidos: PedidoFacturable[],
    dto: FacturarPedidoDto,
    emisor: EmisorElegido,
  ): Promise<FacturaPreparada> {
    this.exigirFacturables(pedidos);
    this.exigirCompatibles(dto);
    if (dto.formaPago !== undefined && !this.catalogoSat.formaDePagoValida(dto.formaPago)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'FORMA_PAGO_INVALIDA',
        message: 'Esa forma de pago no está en el catálogo del SAT para facturas ya pagadas.',
      });
    }

    // La retencion del RESICO depende del regimen de la cuenta de factura.com
    // que emite y de a quien se le factura. No mueve el total: el CFDI va por
    // lo cobrado y la base se desglosa para que base + IVA - retencion lo den.
    const retiene = retieneIsrResico(emisor, dto.rfc);
    const varios = pedidos.length > 1;
    const partes: Comprobante[] = [];
    for (const pedido of pedidos) {
      const comprobante = armarComprobante(
        {
          ...pedido,
          // Las claves del SAT se leen del producto de hoy, no del renglon: no
          // mueven dinero y corregirlas tiene que alcanzar a lo no facturado.
          // La tasa es la congelada; si se vendio sin ella, la configurada
          // despues (`exigirFacturables` ya garantizo que alguna hay).
          items: pedido.items.map((i) => ({
            ...i,
            tasaIva: tasaDeRenglon(i) ?? exigida(i.nombre),
            claveProdServ: i.producto.claveProdServ,
            claveUnidad: this.unidadSat(i.producto.claveUnidad),
          })),
        },
        await this.categoriasDelCupon(pedido.cupon),
        this.claves,
        retiene,
      );
      // La factura va por lo pagado aparte del monedero, redondeado al peso
      // (`totalAFacturar`). Sin ningun producto al 0 % el desglose puede quedar
      // a un centavo de el (`armarComprobante`): eso se acepta. Mas que eso es
      // que el pedido tiene columnas que no suman, y un CFDI timbrado no se
      // puede deshacer.
      const esperado = totalAFacturar(pedido);
      if (comprobante.total.sub(esperado).abs().greaterThan(new Decimal('0.01'))) {
        this.logger.error(
          `El pedido ${pedido.folio} no cuadra para facturar: se esperaba ${esperado.toFixed(2)} ` +
            `(total ${pedido.total.toFixed(2)}), conceptos ${comprobante.total.toFixed(2)}`,
        );
        throw new ConflictException({
          statusCode: 409,
          code: 'FACTURA_NO_CUADRA',
          message: varios
            ? `No pudimos armar la factura del pedido ${pedido.folio}. Factúralo aparte o escríbenos y la emitimos a mano.`
            : 'No pudimos armar la factura de este pedido. Escríbenos y la emitimos a mano.',
        });
      }
      partes.push(
        varios
          ? {
              ...comprobante,
              conceptos: comprobante.conceptos.map((c) => ({
                ...c,
                descripcion: `${c.descripcion} (${pedido.folio})`,
              })),
            }
          : comprobante,
      );
    }

    const comprobante = juntar(partes);
    if (!comprobante.total.greaterThan(0)) {
      throw new ConflictException({
        statusCode: 409,
        code: 'FACTURA_SIN_IMPORTE',
        message: 'Este pedido no tiene importe que facturar.',
      });
    }

    // Se puede corregir la forma de pago que Rapidix dedujo del pedido (pago
    // con tarjeta en la terminal, por ejemplo, queda como efectivo).
    if (dto.formaPago) comprobante.formaPago = dto.formaPago;

    const receptor: Receptor = {
      rfc: dto.rfc,
      razonSocial: dto.razonSocial,
      regimenFiscal: dto.regimenFiscal,
      usoCfdi: dto.usoCfdi,
      cpFiscal: dto.cpFiscal,
      email: dto.email,
    };

    return { pedidos, emisor, receptor, comprobante };
  }

  vista(preparada: FacturaPreparada): VistaFacturaDto {
    const { comprobante, receptor, emisor } = preparada;
    return {
      modo: this.timbradorPara(emisor).modo,
      emisor: { rfc: emisor.rfc, nombre: emisor.nombre, regimen: emisor.regimen, cp: emisor.cp },
      receptor,
      formaPago: comprobante.formaPago,
      metodoPago: 'PUE',
      conceptos: comprobante.conceptos.map((c) => ({
        descripcion: c.descripcion,
        claveProdServ: c.claveProdServ,
        claveUnidad: c.claveUnidad,
        unidad: c.unidad,
        cantidad: c.cantidad,
        valorUnitario: c.valorUnitario.toFixed(6),
        importe: c.importe.toNumber(),
        descuento: c.descuento.toNumber(),
        tasaIva: c.tasa,
        iva: c.iva.toNumber(),
        retencionIsr: c.retencionIsr?.toNumber() ?? 0,
      })),
      subtotal: comprobante.subtotal.toNumber(),
      descuento: comprobante.descuento.toNumber(),
      iva: comprobante.iva.toNumber(),
      retencionIsr: comprobante.retencionIsr.toNumber(),
      total: comprobante.total.toNumber(),
    };
  }

  /**
   * Reserva la factura, se queda con sus pedidos y timbra. Si el proveedor
   * rechaza, la reserva se borra y los pedidos se sueltan solos (`onDelete:
   * SetNull`).
   *
   * La reserva y el apartado van en una transaccion: si otra peticion ya se
   * llevo alguno de los pedidos, no se aparta ninguno (409 TIMBRADO_EN_CURSO).
   * Es la columna `pedidos.facturaId` la que impide dos CFDI del mismo pedido.
   */
  async timbrar(preparada: FacturaPreparada, autor: AutorFactura): Promise<FacturaDto> {
    const { pedidos, emisor, receptor, comprobante } = preparada;
    const conceptos = comprobante.conceptos.map(aGuardado);
    const timbrador = this.timbradorPara(emisor);
    const folios = pedidos.map((p) => p.folio);
    // factura.com no deja repetir el numero de orden. Un pedido solo entra a
    // una factura, asi que su folio (con cuantos mas van) no se repite.
    const numOrden = folios.length === 1 ? folios[0] : `${folios[0]}+${folios.length - 1}`;
    const clientes = new Set(pedidos.map((p) => p.clienteId));

    const reserva = await this.prisma.$transaction(async (tx) => {
      const creada = await tx.factura.create({
        data: {
          clienteId: clientes.size === 1 ? pedidos[0].clienteId : null,
          modo: timbrador.modo,
          // Ya no hay razones sociales: el emisor es la cuenta de las llaves
          // del servidor, y queda congelado con sus datos.
          razonSocialId: null,
          emisorRfc: emisor.rfc,
          emisorNombre: emisor.nombre,
          emisorRegimen: emisor.regimen,
          emisorCp: emisor.cp,
          numOrden,
          creadoPorId: autor.id,
          creadoPorNombre: autor.nombre,
          creadoPorRol: autor.rol,
          ...receptor,
          formaPago: comprobante.formaPago,
          subtotal: comprobante.subtotal,
          descuento: comprobante.descuento,
          iva: comprobante.iva,
          retencionIsr: comprobante.retencionIsr,
          total: comprobante.total,
          conceptos: conceptos as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      const apartados = await tx.pedido.updateMany({
        where: { id: { in: pedidos.map((p) => p.id) }, facturaId: null },
        data: { facturaId: creada.id },
      });
      if (apartados.count !== pedidos.length) {
        throw new ConflictException({
          statusCode: 409,
          code: 'TIMBRADO_EN_CURSO',
          message:
            pedidos.length === 1
              ? 'Ya estamos timbrando la factura de este pedido. Espera un momento.'
              : 'Alguno de los pedidos se acaba de facturar. Vuelve a cargar la lista.',
        });
      }
      return creada;
    });

    // Dos `try` separados a proposito: un timbre rechazado se deshace y se
    // reintenta; un timbre bueno que no se pudo guardar es otro problema.
    let timbrado;
    try {
      timbrado = await timbrador.timbrar({
        folioPedido: numOrden,
        receptor,
        conceptos,
        formaPago: comprobante.formaPago,
      });
    } catch (fallo) {
      await this.prisma.factura.delete({ where: { id: reserva.id } }).catch((e: unknown) => {
        this.logger.error(`No se pudo soltar la reserva de factura ${reserva.id}`, String(e));
      });
      throw this.traducirFallo(fallo, numOrden);
    }

    let factura;
    try {
      factura = await this.prisma.factura.update({
        where: { id: reserva.id },
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
        `CFDI ${timbrado.uuid} de ${folios.join(', ')} timbrado pero NO guardado`,
        JSON.stringify({ timbrado, error: String(fallo) }),
      );
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'FACTURA_SIN_GUARDAR',
        message: `La factura se timbró (folio fiscal ${timbrado.uuid}) pero no pudimos guardarla. Escríbenos con este folio.`,
      });
    }

    return {
      id: factura.id,
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

  // ----------------------------------------------------------------
  // Archivos
  // ----------------------------------------------------------------

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
      where: { estado: EstadoFactura.TIMBRADA, pedidos: { some: { id: pedidoId, clienteId } } },
      include: INCLUIR_DOCUMENTO,
    });
    if (!factura) throw new NotFoundException('Este pedido no tiene factura');
    return this.documentoDe(factura, formato);
  }

  /**
   * PDF o XML de una factura por su id, sin pasar por el pedido: Configuracion
   * -> Fiscal -> Facturacion lista todas las facturas del negocio, y el punto
   * de venta las de su tienda.
   */
  async documentoPorId(facturaId: string, formato: 'pdf' | 'xml'): Promise<DocumentoFactura> {
    const factura = await this.prisma.factura.findFirst({
      where: { id: facturaId, estado: EstadoFactura.TIMBRADA },
      include: INCLUIR_DOCUMENTO,
    });
    if (!factura) throw new NotFoundException('La factura no existe');
    return this.documentoDe(factura, formato);
  }

  private async documentoDe(
    factura: FacturaConPedidos,
    formato: 'pdf' | 'xml',
  ): Promise<DocumentoFactura> {
    const folios = factura.pedidos.map((p) => p.folio);
    const numOrden = factura.numOrden ?? folios[0] ?? factura.id.slice(0, 8);
    const timbrador = await this.timbradorDeFactura({
      modo: factura.modo,
      razonSocialId: factura.razonSocialId,
      emisor:
        factura.emisorRfc && factura.emisorNombre && factura.emisorRegimen && factura.emisorCp
          ? {
              rfc: factura.emisorRfc,
              nombre: factura.emisorNombre,
              regimen: factura.emisorRegimen,
              cp: factura.emisorCp,
            }
          : null,
    });

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
      retencionIsr: factura.retencionIsr,
      total: factura.total,
      conceptos: factura.conceptos as unknown as ConceptoGuardado[],
      timbradaEn: factura.timbradaEn!,
      folioPedido: numOrden,
      folios,
    };

    try {
      const contenido =
        formato === 'pdf' ? await timbrador.pdf(timbrada) : await timbrador.xml(timbrada);
      return {
        contenido,
        nombre: `factura-${numOrden}.${formato}`,
        tipo: formato === 'pdf' ? 'application/pdf' : 'application/xml',
      };
    } catch (fallo) {
      throw this.traducirFallo(fallo, numOrden);
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
  unidadSat(clave: string | null): { clave: string; nombre: string } | null {
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

  /** Las columnas de datos fiscales: tienen los mismos nombres en `clientes` y en `prospectos`. */
  static columnasFiscales(dto: DatosFiscalesDto): {
    rfc: string;
    razonSocial: string;
    regimenFiscal: string;
    usoCfdi: string;
    cpFiscal: string;
    emailFacturacion: string;
  } {
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

  traducirFallo(fallo: unknown, folio: string): Error {
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

/**
 * La tasa con que se factura un renglon: la que congelo al venderse, o si el
 * producto no la tenia entonces, la que tenga hoy. Null = sigue sin configurar.
 */
function tasaDeRenglon(item: {
  tasaIva: TasaIva | null;
  producto: { tasaIva: TasaIva | null };
}): TasaIva | null {
  return item.tasaIva ?? item.producto.tasaIva;
}

/**
 * Por que el pedido no se puede facturar todavia por el IVA: los productos que
 * siguen sin tasa. Null si todos la tienen. La tasa la dice la ley, no el
 * sistema: sin ella no se adivina. El punto de venta lo ensena en su lista.
 */
export function ivaSinConfigurar(
  items: {
    nombre: string;
    cantidad: number;
    tasaIva: TasaIva | null;
    producto: { tasaIva: TasaIva | null };
  }[],
): string | null {
  const nombres = [
    ...new Set(items.filter((i) => i.cantidad > 0 && !tasaDeRenglon(i)).map((i) => i.nombre)),
  ];
  return nombres.length > 0
    ? `Antes de facturar hay que elegir el IVA (0 % o 16 %) en Productos de: ${nombres.join(', ')}.`
    : null;
}

/** Nunca deberia pasar: `exigirFacturables` corre antes. Si pasa, no se adivina. */
function exigida(nombre: string): never {
  throw new ConflictException({
    statusCode: 409,
    code: 'IVA_SIN_CONFIGURAR',
    message: `Antes de facturar hay que elegir el IVA (0 % o 16 %) en Productos de: ${nombre}.`,
  });
}

/**
 * Los comprobantes de varios pedidos en una sola factura: sus conceptos uno
 * tras otro y sus totales sumados. La forma de pago es la del pedido de mayor
 * importe, como en la factura global. Sin retencion: se calcula despues sobre
 * la factura entera.
 */
function juntar(partes: Comprobante[]): Comprobante {
  if (partes.length === 1) return partes[0];
  const sumar = (campo: 'subtotal' | 'descuento' | 'iva' | 'retencionIsr' | 'total') =>
    partes.reduce((s, p) => s.add(p[campo]), new Decimal(0));
  const mayor = partes.reduce((m, p) => (p.total.greaterThan(m.total) ? p : m));
  return {
    conceptos: partes.flatMap((p) => p.conceptos),
    subtotal: sumar('subtotal'),
    descuento: sumar('descuento'),
    iva: sumar('iva'),
    retencionIsr: sumar('retencionIsr'),
    total: sumar('total'),
    formaPago: mayor.formaPago,
  };
}
