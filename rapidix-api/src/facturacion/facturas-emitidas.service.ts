import { Injectable } from '@nestjs/common';
import { EstadoFactura, ModoTimbrado } from '@prisma/client';
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
  modo: ModoTimbrado;
  /** Nombre base de sus archivos, sin extension: el folio y el RFC, para que no se pisen. */
  archivo: string;
}

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
      this.prisma.factura.findMany({
        where: donde,
        include: { pedido: { select: { folio: true } } },
      }),
      this.prisma.facturaGlobal.findMany({ where: donde }),
    ]);

    const filas: FacturaEmitidaDto[] = [
      ...dePedidos.map((f) =>
        this.fila({
          ...f,
          tipo: 'PEDIDO',
          nombre: f.razonSocial,
          respaldo: f.pedido.folio,
        }),
      ),
      ...globales.map((f) =>
        this.fila({
          ...f,
          tipo: 'GLOBAL',
          rfc: PUBLICO_EN_GENERAL.rfc,
          nombre: PUBLICO_EN_GENERAL.razonSocial,
          respaldo: `G${f.numero}`,
        }),
      ),
    ];
    return filas.sort((a, b) => b.timbradaEn.localeCompare(a.timbradaEn));
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
      modo: f.modo,
      // Sin espacios ni barras: el folio lo pone el proveedor.
      archivo: `${serieFolio}-${f.rfc}`.replace(/[^A-Za-z0-9&Ñ_-]/g, '_'),
    };
  }
}
