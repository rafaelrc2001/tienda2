import { Injectable } from '@nestjs/common';
import { EstadoFactura, ModoTimbrado, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { diaEn, inicioDelDia, zonaDelNegocio } from '../ingresos/rango-de-fechas';
import { CatalogoSatService } from './catalogo-sat.service';
import { PUBLICO_EN_GENERAL } from './factura-global';

export type TipoFacturaEmitida = 'PEDIDO' | 'GLOBAL';

/** Un mes con facturas, para el selector de periodo. */
export interface PeriodoFacturasDto {
  anio: number;
  mes: number;
  cantidad: number;
}

/** Un renglon de la tabla de Facturacion: un CFDI de pedido o una factura global. */
export interface FacturaEmitidaDto {
  id: string;
  tipo: TipoFacturaEmitida;
  /** «A-1127»; sin folio del proveedor, el folio del pedido o el consecutivo G12. */
  serieFolio: string;
  uuid: string;
  rfc: string;
  /** Razon social del receptor. */
  nombre: string;
  /** c_FormaPago con su descripcion: «03 · Transferencia electronica de fondos». */
  formaPago: { clave: string; nombre: string };
  total: number;
  timbradaEn: string;
  /** Cuando se pidio: la reserva se escribe justo antes de timbrar. */
  creadaEn: string;
  /**
   * Quien la creo: el cliente desde la app o alguien del personal, con su rol.
   * Null en las de antes de que se guardara.
   */
  creadoPor: { nombre: string; rol: string | null } | null;
  /** La razon social que la emitio. Null en las de antes de que hubiera varias. */
  emisor: { rfc: string; nombre: string } | null;
  /** Los folios de los pedidos que cubre; vacio en la global. */
  pedidos: string[];
  modo: ModoTimbrado;
  /** Nombre base de sus archivos, sin extension: el folio y el RFC, para que no se pisen. */
  archivo: string;
}

/** Lo que se lee de una factura de pedidos para su renglon. */
const INCLUIR_DE_PEDIDOS = {
  pedidos: { select: { folio: true }, orderBy: { folio: 'asc' } },
  emisor: { select: { rfc: true, nombre: true } },
} satisfies Prisma.FacturaInclude;

const INCLUIR_GLOBAL = {
  creadoPor: { select: { nombre: true, rol: true } },
  emisor: { select: { rfc: true, nombre: true } },
} satisfies Prisma.FacturaGlobalInclude;

/**
 * Configuracion -> Fiscal -> Facturacion: todos los CFDI que emitio el negocio,
 * los de los pedidos y las facturas globales juntos, mes por mes.
 *
 * Los meses se cortan en la zona del negocio, como Ingresos: una factura
 * timbrada el 31 a las 19:00 de Mexico es de ese mes aunque en UTC ya sea el 1.
 */
@Injectable()
export class FacturasEmitidasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogoSat: CatalogoSatService,
  ) {}

  /** Los meses que tienen al menos una factura, del mas reciente al mas viejo. */
  async periodos(): Promise<PeriodoFacturasDto[]> {
    const donde = { estado: EstadoFactura.TIMBRADA };
    const [dePedidos, globales] = await Promise.all([
      this.prisma.factura.findMany({ where: donde, select: { timbradaEn: true } }),
      this.prisma.facturaGlobal.findMany({ where: donde, select: { timbradaEn: true } }),
    ]);
    const zona = zonaDelNegocio();
    const cuenta = new Map<string, number>();
    for (const { timbradaEn } of [...dePedidos, ...globales]) {
      if (!timbradaEn) continue;
      const mes = diaEn(timbradaEn, zona).slice(0, 7);
      cuenta.set(mes, (cuenta.get(mes) ?? 0) + 1);
    }
    return [...cuenta.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([mes, cantidad]) => ({
        anio: Number(mes.slice(0, 4)),
        mes: Number(mes.slice(5, 7)),
        cantidad,
      }));
  }

  /** Las facturas de un mes, de la mas reciente a la mas vieja. */
  async delMes(anio: number, mes: number): Promise<FacturaEmitidaDto[]> {
    const zona = zonaDelNegocio();
    const dia = (a: number, m: number) => `${a}-${String(m).padStart(2, '0')}-01`;
    const inicio = inicioDelDia(dia(anio, mes), zona);
    const fin = inicioDelDia(mes === 12 ? dia(anio + 1, 1) : dia(anio, mes + 1), zona);
    const donde = { estado: EstadoFactura.TIMBRADA, timbradaEn: { gte: inicio, lt: fin } };

    const [dePedidos, globales] = await Promise.all([
      this.prisma.factura.findMany({ where: donde, include: INCLUIR_DE_PEDIDOS }),
      this.prisma.facturaGlobal.findMany({ where: donde, include: INCLUIR_GLOBAL }),
    ]);

    const filas: FacturaEmitidaDto[] = [
      ...dePedidos.map((f) => this.deFacturaDePedidos(f)),
      ...globales.map((f) =>
        this.fila({
          ...f,
          tipo: 'GLOBAL',
          rfc: PUBLICO_EN_GENERAL.rfc,
          nombre: PUBLICO_EN_GENERAL.razonSocial,
          respaldo: `G${f.numero}`,
          creadoPor: { nombre: f.creadoPor.nombre, rol: f.creadoPor.rol },
          pedidos: [],
        }),
      ),
    ];
    return filas.sort((a, b) => b.timbradaEn.localeCompare(a.timbradaEn));
  }

  /**
   * Las facturas que cubren pedidos de una tienda —capturados en su mostrador
   * o recogidos en ella—, de la mas reciente a la mas vieja: la pestana
   * Facturacion del punto de venta.
   */
  async deLaTienda(tiendaId: string, limite: number): Promise<FacturaEmitidaDto[]> {
    const facturas = await this.prisma.factura.findMany({
      where: {
        estado: EstadoFactura.TIMBRADA,
        pedidos: { some: { OR: [{ tiendaId }, { turno: { tiendaId } }] } },
      },
      include: INCLUIR_DE_PEDIDOS,
      orderBy: { timbradaEn: 'desc' },
      take: limite,
    });
    return facturas.map((f) => this.deFacturaDePedidos(f));
  }

  private deFacturaDePedidos(
    f: Prisma.FacturaGetPayload<{ include: typeof INCLUIR_DE_PEDIDOS }>,
  ): FacturaEmitidaDto {
    const folios = f.pedidos.map((p) => p.folio);
    return this.fila({
      ...f,
      tipo: 'PEDIDO',
      nombre: f.razonSocial,
      respaldo: f.numOrden ?? folios[0] ?? f.id.slice(0, 8),
      creadoPor: f.creadoPorNombre ? { nombre: f.creadoPorNombre, rol: f.creadoPorRol } : null,
      // Las de antes no congelaron el emisor ni tienen razon social.
      emisor: f.emisor ?? (f.emisorRfc ? { rfc: f.emisorRfc, nombre: f.emisorNombre ?? '' } : null),
      pedidos: folios,
    });
  }

  private fila(f: {
    id: string;
    tipo: TipoFacturaEmitida;
    serie: string | null;
    folio: string | null;
    uuid: string | null;
    rfc: string;
    nombre: string;
    formaPago: string;
    total: { toNumber(): number };
    timbradaEn: Date | null;
    creadoEn: Date;
    creadoPor: { nombre: string; rol: string | null } | null;
    emisor: { rfc: string; nombre: string } | null;
    pedidos: string[];
    modo: ModoTimbrado;
    /** Lo que identifica la factura si el proveedor no dio folio. */
    respaldo: string;
  }): FacturaEmitidaDto {
    const serieFolio = f.folio ? [f.serie, f.folio].filter(Boolean).join('-') : f.respaldo;
    const forma = this.catalogoSat.formasDePago().find((x) => x.clave === f.formaPago);
    return {
      id: f.id,
      tipo: f.tipo,
      serieFolio,
      uuid: f.uuid!,
      rfc: f.rfc,
      nombre: f.nombre,
      formaPago: { clave: f.formaPago, nombre: forma?.descripcion ?? '' },
      total: f.total.toNumber(),
      timbradaEn: f.timbradaEn!.toISOString(),
      creadaEn: f.creadoEn.toISOString(),
      creadoPor: f.creadoPor,
      emisor: f.emisor,
      pedidos: f.pedidos,
      modo: f.modo,
      // Sin espacios ni barras: el folio lo pone el proveedor.
      archivo: `${serieFolio}-${f.rfc}`.replace(/[^A-Za-z0-9&Ñ_-]/g, '_'),
    };
  }
}
