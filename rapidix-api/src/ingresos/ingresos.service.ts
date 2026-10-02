import { Injectable } from '@nestjs/common';
import { ConceptoIngreso, MetodoPago, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BuscarIngresosDto } from './dto/buscar-ingresos.dto';
import { rangoDeFechas } from './rango-de-fechas';

const Decimal = Prisma.Decimal;

/** Un renglon del libro, tal como lo pinta la pestana de Ingresos. */
export interface IngresoDto {
  id: string;
  creadoEn: string;
  concepto: ConceptoIngreso;
  /** Folio de reparto (ENTREGA) o de pedido (CXC). */
  referencia: string;
  monto: number;
  metodo: MetodoPago;
  nota: string | null;
  /** Quien lo acepto. */
  registradoPorNombre: string;
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
}

/** Tope de renglones por consulta. El total no lo sufre: se suma en la base. */
const MAXIMO = 500;

/**
 * El libro de lo que Finanzas acepto: el dinero de cada entrega, los abonos
 * de los repartidores y los pagos de las cuentas por cobrar.
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
      },
    });
  }

  /**
   * Los ingresos de un rango de dias, del mas reciente al mas viejo, con su
   * total. El total lo suma la base sobre el rango entero: la pantalla no
   * suma, y si sumara solo veria los renglones que le llegaron.
   */
  async listar(filtros: BuscarIngresosDto): Promise<ListadoIngresosDto> {
    const rango = rangoDeFechas(filtros.desde, filtros.hasta);
    const where: Prisma.IngresoWhereInput = {
      creadoEn: { gte: rango.inicio, lt: rango.fin },
      ...(filtros.concepto && { concepto: filtros.concepto }),
    };

    const [ingresos, suma] = await Promise.all([
      this.prisma.ingreso.findMany({
        where,
        orderBy: { creadoEn: 'desc' },
        take: MAXIMO,
        include: { registradoPor: { select: { nombre: true } } },
      }),
      this.prisma.ingreso.aggregate({ where, _sum: { monto: true }, _count: true }),
    ]);

    return {
      desde: rango.desde,
      hasta: rango.hasta,
      ingresos: ingresos.map((i) => ({
        id: i.id,
        creadoEn: i.creadoEn.toISOString(),
        concepto: i.concepto,
        referencia: i.referencia,
        monto: i.monto.toNumber(),
        metodo: i.metodo,
        nota: i.nota,
        registradoPorNombre: i.registradoPor.nombre,
      })),
      total: (suma._sum.monto ?? new Decimal(0)).toNumber(),
      cuantos: suma._count,
    };
  }
}
