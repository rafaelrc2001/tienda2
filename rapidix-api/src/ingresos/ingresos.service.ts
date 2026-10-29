import { Injectable } from '@nestjs/common';
import { ConceptoIngreso, MetodoPago, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { totalesDelTurno } from '../pdv/corte-de-caja';
import { BuscarIngresosDto } from './dto/buscar-ingresos.dto';
import { rangoDeFechas } from './rango-de-fechas';

const Decimal = Prisma.Decimal;

/**
 * Lo que entro en todo el cierre de un turno, por forma de pago, como lo
 * ensena la tabla de Turnos del PDV. El efectivo es el aceptado, no el que
 * dice el sistema: un faltante no es dinero que entro.
 */
export interface CierreDto {
  /** Pedidos cobrados en el turno. */
  pedidos: number;
  efectivo: number;
  transferencia: number;
  billetera: number;
  /**
   * Los que salieron a credito y lo que quedo a deber. No es dinero que entro:
   * no suma al monto ni al total, se ensena para que el cierre explique esa venta.
   */
  aCredito: number;
  credito: number;
}

/** Un renglon del libro, tal como lo pinta la pestana de Ingresos. */
export interface IngresoDto {
  id: string;
  creadoEn: string;
  concepto: ConceptoIngreso;
  /** Folio de reparto (ENTREGA), de pedido (CXC) o de turno (PDV). */
  referencia: string;
  /** En el corte de caja de un turno, el cierre entero: efectivo, transferencia y billetera. */
  monto: number;
  metodo: MetodoPago;
  nota: string | null;
  /** Quien lo acepto. */
  registradoPorNombre: string;
  /**
   * Solo en el dinero con que se acepta un corte de caja (no en sus abonos):
   * el desglose de todo el cierre. `null` en los demas.
   */
  cierre: CierreDto | null;
}

export interface ListadoIngresosDto {
  /** El rango que de verdad se consulto: sin fechas, hoy. */
  desde: string;
  hasta: string;
  ingresos: IngresoDto[];
  /** La suma de **todo** el rango, no solo de los renglones que viajan. */
  total: number;
  /** Cuantos hay en el rango. Si pasa de los que viajan, hay que acotar. */
  cuantos: number;
}

/** Lo que hace falta para escribir un ingreso. */
export interface NuevoIngreso {
  concepto: ConceptoIngreso;
  referencia: string;
  monto: Prisma.Decimal;
  metodo: MetodoPago;
  nota?: string | null;
  registradoPorId: string;
  corteId?: string;
  corteAbonoId?: string;
  pagoPedidoId?: string;
  turnoPdvId?: string;
  turnoAbonoId?: string;
}

/** Tope de renglones por consulta. El total no lo sufre: se suma en la base. */
const MAXIMO = 500;

/**
 * El libro de lo que Finanzas acepto: el dinero de cada entrega, los abonos
 * de los repartidores, los pagos de las cuentas por cobrar y el efectivo de
 * los cortes de caja del punto de venta.
 *
 * Solo se escribe y solo desde otra transaccion: un ingreso nace junto con lo
 * que lo causa —aceptar un dinero, cobrar un pago— o no nace. Por eso
 * `registrar()` pide el `tx` y no hay ruta que cree, edite o borre ingresos.
 */
@Injectable()
export class IngresosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Escribe un ingreso dentro de la transaccion de quien lo causa.
   *
   * Un monto en cero no deja renglon: aceptar un corte sin efectivo —todo
   * pagado en linea o a credito— no es dinero que entre, y el libro solo
   * tiene dinero.
   */
  async registrar(tx: Prisma.TransactionClient, ingreso: NuevoIngreso): Promise<void> {
    if (ingreso.monto.lte(0)) return;
    await tx.ingreso.create({
      data: {
        concepto: ingreso.concepto,
        referencia: ingreso.referencia,
        monto: ingreso.monto,
        metodo: ingreso.metodo,
        nota: ingreso.nota?.trim() || null,
        registradoPorId: ingreso.registradoPorId,
        corteId: ingreso.corteId,
        corteAbonoId: ingreso.corteAbonoId,
        pagoPedidoId: ingreso.pagoPedidoId,
        turnoPdvId: ingreso.turnoPdvId,
        turnoAbonoId: ingreso.turnoAbonoId,
      },
    });
  }

  /**
   * Los ingresos de un rango de dias, del mas reciente al mas viejo, con su
   * total. El total lo suma la base sobre el rango entero: la pantalla no
   * suma, y si sumara solo veria los renglones que le llegaron.
   *
   * El libro solo guarda el efectivo de un corte de caja, pero la pantalla
   * ensena el cierre entero: a ese renglon se le suma lo que el turno cobro
   * por transferencia y con billetera, y lo mismo al total. Los abonos son
   * solo efectivo y se quedan como estan.
   */
  async listar(filtros: BuscarIngresosDto): Promise<ListadoIngresosDto> {
    const rango = rangoDeFechas(filtros.desde, filtros.hasta);
    const where: Prisma.IngresoWhereInput = {
      creadoEn: { gte: rango.inicio, lt: rango.fin },
      ...(filtros.concepto && { concepto: filtros.concepto }),
    };

    const [ingresos, suma, cierres] = await Promise.all([
      this.prisma.ingreso.findMany({
        where,
        orderBy: { creadoEn: 'desc' },
        take: MAXIMO,
        include: { registradoPor: { select: { nombre: true } } },
      }),
      this.prisma.ingreso.aggregate({ where, _sum: { monto: true }, _count: true }),
      // Todos los del rango y no solo los que viajan: el total los necesita.
      this.prisma.ingreso.findMany({
        where: { ...where, turnoPdvId: { not: null }, turnoAbonoId: null },
        select: {
          id: true,
          monto: true,
          turnoPdv: {
            select: {
              pedidos: {
                select: {
                  estado: true,
                  estadoPago: true,
                  metodoPago: true,
                  metodoEntrega: true,
                  total: true,
                  pagadoConBilletera: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const cierrePorIngreso = new Map<string, { cierre: CierreDto; resto: Prisma.Decimal }>();
    let resto = new Decimal(0);
    for (const ingreso of cierres) {
      const totales = totalesDelTurno(ingreso.turnoPdv?.pedidos ?? []);
      const sinEfectivo = totales.transferencia.add(totales.billetera);
      resto = resto.add(sinEfectivo);
      cierrePorIngreso.set(ingreso.id, {
        resto: sinEfectivo,
        cierre: {
          pedidos: totales.cobrados,
          efectivo: ingreso.monto.toNumber(),
          transferencia: totales.transferencia.toNumber(),
          billetera: totales.billetera.toNumber(),
          aCredito: totales.aCredito,
          credito: totales.credito.toNumber(),
        },
      });
    }

    return {
      desde: rango.desde,
      hasta: rango.hasta,
      ingresos: ingresos.map((i) => {
        const delCierre = cierrePorIngreso.get(i.id);
        return {
          id: i.id,
          creadoEn: i.creadoEn.toISOString(),
          concepto: i.concepto,
          referencia: i.referencia,
          monto: (delCierre ? i.monto.add(delCierre.resto) : i.monto).toNumber(),
          metodo: i.metodo,
          nota: i.nota,
          registradoPorNombre: i.registradoPor.nombre,
          cierre: delCierre?.cierre ?? null,
        };
      }),
      total: (suma._sum.monto ?? new Decimal(0)).add(resto).toNumber(),
      cuantos: suma._count,
    };
  }
}
