import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EstadoFactura, ModoTimbrado, Prisma, TasaIva } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { aGuardado, claveUnidad, ConceptoGuardado } from './comprobante';
import { REGIMENES_FISCALES, USOS_CFDI } from './catalogos-sat';
import { CatalogoSatService, FormaPagoSat } from './catalogo-sat.service';
import {
  armarFacturaGlobal,
  formaDePagoGlobal,
  MESES_SAT,
  mesesCompatibles,
  OpcionSat,
  PERIODICIDADES,
  PUBLICO_EN_GENERAL,
  RenglonGlobal,
} from './factura-global';
import { DocumentoFactura, FacturacionService } from './facturacion.service';
import { PrevisualizarFacturaGlobalDto, TimbrarFacturaGlobalDto } from './dto/factura-global.dto';
import { FacturaTimbrada, Receptor } from './timbrador';
import { emisorDesdeEntorno } from './timbrador-simulado';

const Decimal = Prisma.Decimal;

/** Igual que en `FacturacionService`: una reserva mas vieja se da por abandonada. */
const VIGENCIA_RESERVA_MS = 2 * 60_000;

/** c_ClaveProdServ de los productos sin clave propia: «No existe en el catalogo». */
const CLAVE_GENERICA = process.env.FACTURACION_CLAVE_PRODUCTO?.trim() || '01010101';

/** El folio cabe en la columna Factura del estado de cuenta (8 caracteres). */
const ANCHO_FOLIO = 8;

/** Lo fijo del receptor: se ensena en el modal y no se edita. */
export interface ReceptorGlobalDto {
  rfc: string;
  razonSocial: string;
  regimenFiscal: OpcionSat;
  usoCfdi: OpcionSat;
  /** El del lugar de expedicion del negocio. */
  cpFiscal: string;
  metodoPago: OpcionSat;
}

export interface ProductoFacturableDto {
  id: string;
  nombre: string;
  /** La de Productos, o la generica 01010101 si no tiene. */
  claveProdServ: string;
  /** Si la clave es la generica porque el producto no tiene una asignada. */
  claveGenerica: boolean;
  tasaIva: TasaIva;
}

/** `GET .../factura-global/datos`: todo lo que el modal necesita para pintarse. */
export interface DatosFacturaGlobalDto {
  receptor: ReceptorGlobalDto;
  formasPago: FormaPagoSat[];
  periodicidades: OpcionSat[];
  meses: OpcionSat[];
  productos: ProductoFacturableDto[];
  modo: ModoTimbrado;
}

export interface ConceptoGlobalDto {
  productoId: string;
  descripcion: string;
  claveProdServ: string;
  claveUnidad: string;
  cantidad: number;
  /** Sin IVA, con los seis decimales que admite el SAT. */
  valorUnitario: string;
  importe: number;
  tasaIva: TasaIva;
  iva: number;
  /** Importe mas IVA. */
  total: number;
}

export interface VistaFacturaGlobalDto {
  /** La suma de los depositos elegidos: lo que tiene que dar la factura. */
  total: number;
  subtotal: number;
  iva: number;
  /** Subtotal mas IVA; sin productos todavia, cero. */
  totalFactura: number;
  /**
   * `total` menos `totalFactura`: casi siempre cero. Con un solo producto al
   * 16 % hay montos que no se alcanzan y la factura queda un centavo arriba.
   */
  diferencia: number;
  conceptos: ConceptoGlobalDto[];
  /** La forma de pago del deposito de mayor monto, como lo pide el SAT. */
  formaPagoSugerida: string;
}

export interface FacturaGlobalDto {
  id: string;
  numero: number;
  uuid: string;
  modo: ModoTimbrado;
  serie: string | null;
  folio: string | null;
  /** Lo que quedo escrito en la columna Factura de los movimientos. */
  folioMovimientos: string;
  total: number;
  timbradaEn: string;
}

interface Armada {
  movimientoIds: string[];
  total: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  iva: Prisma.Decimal;
  totalFactura: Prisma.Decimal;
  diferencia: Prisma.Decimal;
  conceptos: ConceptoGlobalDto[];
  guardados: ConceptoGuardado[];
  formaPagoSugerida: string;
}

/**
 * Finanzas -> Bancos -> Factura global: los depositos de quien no pidio
 * factura, timbrados juntos a PUBLICO EN GENERAL.
 *
 * El total es la suma exacta de los depositos palomeados (con centavos, sin
 * redondear al peso como la factura de un pedido) y los productos los elige
 * Finanzas; los precios los reparte `armarFacturaGlobal` para que todo cuadre.
 * Al timbrar, el folio se escribe en la columna Factura de esos depositos.
 */
@Injectable()
export class FacturaGlobalService {
  private readonly logger = new Logger(FacturaGlobalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogoSat: CatalogoSatService,
    private readonly facturacion: FacturacionService,
  ) {}

  async datos(): Promise<DatosFacturaGlobalDto> {
    const productos = await this.prisma.producto.findMany({
      where: { eliminadoEn: null },
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true, claveProdServ: true, tasaIva: true },
    });
    return {
      receptor: await this.receptorFijo(),
      formasPago: this.catalogoSat.formasDePago(),
      periodicidades: PERIODICIDADES,
      meses: MESES_SAT,
      productos: productos.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        claveProdServ: p.claveProdServ ?? CLAVE_GENERICA,
        claveGenerica: !p.claveProdServ,
        tasaIva: p.tasaIva,
      })),
      modo: this.facturacion.timbrador.modo,
    };
  }

  async previsualizar(dto: PrevisualizarFacturaGlobalDto): Promise<VistaFacturaGlobalDto> {
    const armada = await this.armar(dto);
    return {
      total: armada.total.toNumber(),
      subtotal: armada.subtotal.toNumber(),
      iva: armada.iva.toNumber(),
      totalFactura: armada.totalFactura.toNumber(),
      diferencia: armada.diferencia.toNumber(),
      conceptos: armada.conceptos,
      formaPagoSugerida: armada.formaPagoSugerida,
    };
  }

  /**
   * Timbra la factura global. Los candados van en este orden:
   *
   *  1. Los depositos existen, son positivos y no tienen factura (`armar`).
   *  2. Los productos existen, no se repiten y el total alcanza (`armar`).
   *  3. La forma de pago esta en el catalogo y el mes cabe con la periodicidad.
   *  4. En una transaccion se crea la reserva y se apartan los depositos; si
   *     otro ya se llevo alguno, no se aparta ninguno (409).
   *  5. Se timbra. Si el proveedor rechaza, la reserva se borra y los
   *     depositos se sueltan solos (`onDelete: SetNull`).
   *  6. Se marca timbrada y se escribe el folio en los depositos.
   */
  async timbrar(dto: TimbrarFacturaGlobalDto, usuarioId: string): Promise<FacturaGlobalDto> {
    const armada = await this.armar(dto);

    if (!this.catalogoSat.formaDePagoValida(dto.formaPago)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'FORMA_PAGO_INVALIDA',
        message: 'Esa forma de pago no está en el catálogo del SAT para facturas ya pagadas.',
      });
    }
    if (!mesesCompatibles(dto.periodicidad, dto.meses)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'MESES_INCOMPATIBLES',
        message:
          dto.periodicidad === '05'
            ? 'Con periodicidad bimestral elige un bimestre (Enero-Febrero, Marzo-Abril…).'
            : 'Elige un solo mes: los bimestres son para la periodicidad bimestral.',
      });
    }

    const receptor: Receptor = {
      rfc: PUBLICO_EN_GENERAL.rfc,
      razonSocial: PUBLICO_EN_GENERAL.razonSocial,
      regimenFiscal: PUBLICO_EN_GENERAL.regimenFiscal,
      usoCfdi: PUBLICO_EN_GENERAL.usoCfdi,
      cpFiscal: (await this.receptorFijo()).cpFiscal,
      email: dto.email ?? null,
    };
    const informacionGlobal = { periodicidad: dto.periodicidad, meses: dto.meses, anio: dto.anio };
    const timbrador = this.facturacion.timbrador;

    const reserva = await this.prisma.$transaction(async (tx) => {
      const creada = await tx.facturaGlobal.create({
        data: {
          modo: timbrador.modo,
          ...informacionGlobal,
          cpFiscal: receptor.cpFiscal,
          email: receptor.email,
          formaPago: dto.formaPago,
          subtotal: armada.subtotal,
          iva: armada.iva,
          // El del CFDI: puede quedar un centavo arriba de lo depositado.
          total: armada.totalFactura,
          conceptos: armada.guardados as unknown as Prisma.InputJsonValue,
          creadoPorId: usuarioId,
        },
        select: { id: true, numero: true },
      });
      const apartados = await tx.movimientoBancario.updateMany({
        where: { id: { in: armada.movimientoIds }, facturaGlobalId: null, factura: null },
        data: { facturaGlobalId: creada.id },
      });
      if (apartados.count !== armada.movimientoIds.length) {
        throw new ConflictException({
          statusCode: 409,
          code: 'MOVIMIENTO_YA_FACTURADO',
          message: 'Alguno de los movimientos se acaba de facturar. Vuelve a cargar el periodo.',
        });
      }
      return creada;
    });
    const folioPedido = numeroDeOrden(reserva);

    let timbrado;
    try {
      timbrado = await timbrador.timbrar({
        folioPedido,
        receptor,
        conceptos: armada.guardados,
        formaPago: dto.formaPago,
        informacionGlobal,
      });
    } catch (fallo) {
      await this.prisma.facturaGlobal.delete({ where: { id: reserva.id } }).catch((e: unknown) => {
        this.logger.error(
          `No se pudo soltar la reserva de factura global ${reserva.id}`,
          String(e),
        );
      });
      throw this.facturacion.traducirFallo(fallo, folioPedido);
    }

    const folioMovimientos = folioCorto(timbrado.serie, timbrado.folio, reserva.numero);
    try {
      const [factura] = await this.prisma.$transaction([
        this.prisma.facturaGlobal.update({
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
        }),
        this.prisma.movimientoBancario.updateMany({
          where: { facturaGlobalId: reserva.id },
          data: { factura: folioMovimientos },
        }),
      ]);
      return aDto(factura);
    } catch (fallo) {
      // El CFDI ya existe ante el SAT: se deja en el log para darlo de alta a
      // mano. La reserva queda y sigue apartando los depositos.
      this.logger.error(
        `CFDI global ${timbrado.uuid} (${folioPedido}) timbrado pero NO guardado`,
        JSON.stringify({ timbrado, error: String(fallo) }),
      );
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'FACTURA_SIN_GUARDAR',
        message: `La factura se timbró (folio fiscal ${timbrado.uuid}) pero no se pudo guardar. Anota este folio.`,
      });
    }
  }

  /**
   * Las facturas globales que cubren depositos de un periodo, de la mas
   * reciente a la mas vieja: la tabla debajo del estado de cuenta, desde donde
   * se bajan el PDF y el XML.
   */
  async delPeriodo(periodoId: string): Promise<FacturaGlobalDto[]> {
    const facturas = await this.prisma.facturaGlobal.findMany({
      where: { estado: EstadoFactura.TIMBRADA, movimientos: { some: { periodoId } } },
      orderBy: { timbradaEn: 'desc' },
    });
    return facturas.map(aDto);
  }

  async documento(id: string, formato: 'pdf' | 'xml'): Promise<DocumentoFactura> {
    const factura = await this.prisma.facturaGlobal.findFirst({
      where: { id, estado: EstadoFactura.TIMBRADA },
    });
    if (!factura) throw new NotFoundException('La factura global no existe');
    const folioPedido = `G${factura.numero}`;

    const timbrada: FacturaTimbrada = {
      rfc: PUBLICO_EN_GENERAL.rfc,
      razonSocial: PUBLICO_EN_GENERAL.razonSocial,
      regimenFiscal: PUBLICO_EN_GENERAL.regimenFiscal,
      usoCfdi: PUBLICO_EN_GENERAL.usoCfdi,
      cpFiscal: factura.cpFiscal,
      email: factura.email,
      uuid: factura.uuid!,
      proveedorId: factura.proveedorId,
      serie: factura.serie,
      folio: factura.folio,
      formaPago: factura.formaPago,
      subtotal: factura.subtotal,
      descuento: new Decimal(0),
      iva: factura.iva,
      total: factura.total,
      conceptos: factura.conceptos as unknown as ConceptoGuardado[],
      timbradaEn: factura.timbradaEn!,
      folioPedido,
      informacionGlobal: {
        periodicidad: factura.periodicidad,
        meses: factura.meses,
        anio: factura.anio,
      },
    };

    const timbrador = this.facturacion.timbradorDelModo(factura.modo);
    try {
      const contenido =
        formato === 'pdf' ? await timbrador.pdf(timbrada) : await timbrador.xml(timbrada);
      return {
        contenido,
        nombre: `factura-global-${folioPedido}.${formato}`,
        tipo: formato === 'pdf' ? 'application/pdf' : 'application/xml',
      };
    } catch (fallo) {
      throw this.facturacion.traducirFallo(fallo, folioPedido);
    }
  }

  // ----------------------------------------------------------------
  // Ayudas
  // ----------------------------------------------------------------

  /** El receptor generico. El CP es el de Configuracion -> Fiscal, o el del emisor de pruebas. */
  private async receptorFijo(): Promise<ReceptorGlobalDto> {
    const config = await this.prisma.configuracionNegocio.findUnique({
      where: { id: 1 },
      select: { fiscalCp: true },
    });
    const nombre = (lista: OpcionSat[], clave: string): OpcionSat => ({
      clave,
      nombre: lista.find((x) => x.clave === clave)?.nombre ?? '',
    });
    return {
      rfc: PUBLICO_EN_GENERAL.rfc,
      razonSocial: PUBLICO_EN_GENERAL.razonSocial,
      regimenFiscal: nombre(REGIMENES_FISCALES, PUBLICO_EN_GENERAL.regimenFiscal),
      usoCfdi: nombre(USOS_CFDI, PUBLICO_EN_GENERAL.usoCfdi),
      cpFiscal: config?.fiscalCp ?? emisorDesdeEntorno().cp,
      metodoPago: { clave: 'PUE', nombre: 'Pago en una sola exhibición' },
    };
  }

  /**
   * Lo que comparten la vista previa y el timbre, para que no diverjan: lee y
   * valida los depositos y los productos y reparte el total.
   */
  private async armar(dto: PrevisualizarFacturaGlobalDto): Promise<Armada> {
    // Las reservas abandonadas (la API se reinicio a media llamada) sueltan
    // sus depositos al borrarse.
    await this.prisma.facturaGlobal.deleteMany({
      where: {
        estado: EstadoFactura.TIMBRANDO,
        creadoEn: { lt: new Date(Date.now() - VIGENCIA_RESERVA_MS) },
      },
    });

    const movimientoIds = [...new Set(dto.movimientoIds)];
    const movimientos = await this.prisma.movimientoBancario.findMany({
      where: { id: { in: movimientoIds } },
      select: { id: true, cantidad: true, metodo: true, factura: true, facturaGlobalId: true },
    });
    if (movimientos.length !== movimientoIds.length) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'MOVIMIENTO_NO_ENCONTRADO',
        message: 'Alguno de los movimientos ya no existe. Vuelve a cargar el periodo.',
      });
    }
    if (movimientos.some((m) => !m.cantidad.greaterThan(0))) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'MOVIMIENTO_NO_FACTURABLE',
        message: 'Solo se facturan los depósitos: las cantidades en negativo no.',
      });
    }
    if (movimientos.some((m) => m.factura !== null || m.facturaGlobalId !== null)) {
      throw new ConflictException({
        statusCode: 409,
        code: 'MOVIMIENTO_YA_FACTURADO',
        message: 'Alguno de los movimientos ya tiene factura.',
      });
    }
    const total = movimientos.reduce((s, m) => s.add(m.cantidad), new Decimal(0));
    const formaPagoSugerida = formaDePagoGlobal(movimientos);
    // Sin productos todavia: solo la suma de lo palomeado.
    if (dto.renglones.length === 0) {
      return {
        movimientoIds,
        total,
        subtotal: new Decimal(0),
        iva: new Decimal(0),
        totalFactura: new Decimal(0),
        diferencia: new Decimal(0),
        conceptos: [],
        guardados: [],
        formaPagoSugerida,
      };
    }

    const productoIds = dto.renglones.map((r) => r.productoId);
    if (new Set(productoIds).size !== productoIds.length) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'PRODUCTO_REPETIDO',
        message: 'Cada producto va una sola vez: suma sus cantidades en un renglón.',
      });
    }
    const productos = await this.prisma.producto.findMany({
      where: { id: { in: productoIds }, eliminadoEn: null },
    });
    const porId = new Map(productos.map((p) => [p.id, p]));
    if (porId.size !== productoIds.length) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'PRODUCTO_NO_ENCONTRADO',
        message: 'Alguno de los productos ya no existe.',
      });
    }

    const renglones: RenglonGlobal[] = dto.renglones.map((r) => {
      const p = porId.get(r.productoId)!;
      const unidad = this.facturacion.unidadSat(p.claveUnidad) ?? claveUnidad(p.unidad);
      return {
        descripcion: `Venta global - ${p.nombre}`,
        claveProdServ: p.claveProdServ ?? CLAVE_GENERICA,
        claveUnidad: unidad.clave,
        unidad: unidad.nombre,
        cantidad: r.cantidad,
        tasa: p.tasaIva,
        peso: p.precioVenta.mul(r.cantidad),
      };
    });

    const armada = armarFacturaGlobal(total, renglones);
    if ('error' in armada) {
      throw new ConflictException({
        statusCode: 409,
        code: 'MONTO_INSUFICIENTE',
        message: `$${total.toFixed(2)} no alcanza para repartirse entre tantos productos.`,
      });
    }

    return {
      movimientoIds,
      total,
      subtotal: armada.subtotal,
      iva: armada.iva,
      totalFactura: armada.total,
      diferencia: armada.diferencia,
      conceptos: armada.conceptos.map((c, i) => ({
        productoId: dto.renglones[i].productoId,
        descripcion: c.descripcion,
        claveProdServ: c.claveProdServ,
        claveUnidad: c.claveUnidad,
        cantidad: c.cantidad,
        valorUnitario: c.valorUnitario.toFixed(6),
        importe: c.importe.toNumber(),
        tasaIva: c.tasa,
        iva: c.iva.toNumber(),
        total: c.importe.add(c.iva).toNumber(),
      })),
      guardados: armada.conceptos.map(aGuardado),
      formaPagoSugerida,
    };
  }
}

/**
 * El numero de orden (`NumOrder`) con el que se timbra: el consecutivo y un
 * pedazo del id. factura.com no deja timbrar dos veces el mismo numero de
 * orden, y el consecutivo solo no basta: la API local y la de Railway (o una
 * base recien reseteada) comparten la cuenta del sandbox y las dos empiezan
 * en G1. El id es un uuid, asi que no se repite entre bases.
 */
function numeroDeOrden(factura: { id: string; numero: number }): string {
  return `G${factura.numero}-${factura.id.slice(0, 8)}`;
}

/** Solo de una factura ya timbrada: la reserva no tiene UUID ni fecha. */
function aDto(factura: {
  id: string;
  numero: number;
  uuid: string | null;
  modo: ModoTimbrado;
  serie: string | null;
  folio: string | null;
  total: Prisma.Decimal;
  timbradaEn: Date | null;
}): FacturaGlobalDto {
  return {
    id: factura.id,
    numero: factura.numero,
    uuid: factura.uuid!,
    modo: factura.modo,
    serie: factura.serie,
    folio: factura.folio,
    folioMovimientos: folioCorto(factura.serie, factura.folio, factura.numero),
    total: factura.total.toNumber(),
    timbradaEn: factura.timbradaEn!.toISOString(),
  };
}

/**
 * El folio para la columna Factura: serie y folio juntos si caben (A1127), si
 * no solo el folio, y si tampoco, el consecutivo propio (G12).
 */
export function folioCorto(serie: string | null, folio: string | null, numero: number): string {
  const completo = `${serie ?? ''}${folio ?? ''}`;
  if (folio && completo.length <= ANCHO_FOLIO) return completo;
  if (folio && folio.length <= ANCHO_FOLIO) return folio;
  return `G${numero}`;
}
