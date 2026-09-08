import { Injectable } from '@nestjs/common';
import { EstadoCupon, OrigenCupon } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface FilaMetrica {
  origen: OrigenCupon;
  sourceCode: string;
  titulo: string;
  generados: number;
  utilizados: number;
  porcentajeUtilizacion: number;
  descuentoOtorgado: number;
}

export interface MetricasCupones {
  resumen: {
    generados: number;
    utilizados: number;
    porcentajeUtilizacion: number;
    descuentoTotalOtorgado: number;
    clientesConCupon: number;
    activos: number;
    vencidos: number;
    cancelados: number;
  };
  porTipo: FilaMetrica[];
}

const porcentaje = (parte: number, total: number): number =>
  total === 0 ? 0 : Math.round((parte / total) * 100);

@Injectable()
export class MetricasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Todo se calcula en vivo desde los cupones realmente emitidos y usados
   * (Word 4.9.5): no hay contadores almacenados que puedan desincronizarse.
   */
  async calcular(): Promise<MetricasCupones> {
    const [porEstado, grupos, descuentoTotal, clientesConCupon, tipos, campanias] =
      await Promise.all([
        this.prisma.cuponEmitido.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.cuponEmitido.groupBy({
          by: ['sourceKind', 'sourceCode', 'status'],
          _count: { _all: true },
          _sum: { discountApplied: true },
        }),
        this.prisma.cuponEmitido.aggregate({
          where: { status: EstadoCupon.USED },
          _sum: { discountApplied: true },
        }),
        // Solo clientes: los cupones de un prospecto tienen `clienteId` a null
        // y, sin este filtro, todos juntos contarian como uno mas.
        this.prisma.cuponEmitido
          .findMany({
            where: { clienteId: { not: null } },
            distinct: ['clienteId'],
            select: { clienteId: true },
          })
          .then((filas) => filas.length),
        this.prisma.tipoCuponCicloVida.findMany({ select: { code: true, title: true } }),
        this.prisma.campania.findMany({ select: { name: true, title: true } }),
      ]);

    const contarEstado = (estado: EstadoCupon): number =>
      porEstado.find((g) => g.status === estado)?._count._all ?? 0;

    const generados = porEstado.reduce((s, g) => s + g._count._all, 0);
    const utilizados = contarEstado(EstadoCupon.USED);

    // Titulo legible para cada origen; si la campana se borro, se muestra el
    // codigo tal cual en vez de dejar la fila sin nombre.
    const titulos = new Map<string, string>([
      ...tipos.map((t) => [`${OrigenCupon.LIFECYCLE}:${t.code}`, t.title] as const),
      ...campanias.map((c) => [`${OrigenCupon.CAMPAIGN}:${c.name}`, c.title] as const),
    ]);

    const claves = [...new Set(grupos.map((g) => `${g.sourceKind}:${g.sourceCode}`))];
    const porTipo: FilaMetrica[] = claves
      .map((clave) => {
        const [origen, sourceCode] = clave.split(':') as [OrigenCupon, string];
        const delOrigen = grupos.filter(
          (g) => g.sourceKind === origen && g.sourceCode === sourceCode,
        );
        const gen = delOrigen.reduce((s, g) => s + g._count._all, 0);
        const usa = delOrigen
          .filter((g) => g.status === EstadoCupon.USED)
          .reduce((s, g) => s + g._count._all, 0);
        const descuento = delOrigen
          .filter((g) => g.status === EstadoCupon.USED)
          .reduce((s, g) => s + (g._sum.discountApplied?.toNumber() ?? 0), 0);

        return {
          origen,
          sourceCode,
          titulo: titulos.get(clave) ?? sourceCode,
          generados: gen,
          utilizados: usa,
          porcentajeUtilizacion: porcentaje(usa, gen),
          descuentoOtorgado: Math.round(descuento * 100) / 100,
        };
      })
      .sort((a, b) => b.generados - a.generados);

    return {
      resumen: {
        generados,
        utilizados,
        porcentajeUtilizacion: porcentaje(utilizados, generados),
        descuentoTotalOtorgado:
          Math.round((descuentoTotal._sum.discountApplied?.toNumber() ?? 0) * 100) / 100,
        clientesConCupon,
        activos: contarEstado(EstadoCupon.ACTIVE),
        vencidos: contarEstado(EstadoCupon.EXPIRED),
        cancelados: contarEstado(EstadoCupon.CANCELLED),
      },
      porTipo,
    };
  }
}
