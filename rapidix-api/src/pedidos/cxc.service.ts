import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConceptoIngreso, EstadoPago, MetodoPago, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { IngresosService } from '../ingresos/ingresos.service';
import { actorDe } from './bitacora';
import { pagadoDelPedido, pagoCabe, saldoDelPedido } from './cxc';
import { RegistrarPagoDto } from './dto/registrar-pago.dto';
import { FinanzasService } from './finanzas.service';
import { FlujoPedidosService } from './flujo-pedidos.service';

const Decimal = Prisma.Decimal;

/** Una cuenta por cobrar, tal como la pinta la pestana de CXC. */
export interface PedidoCxcDto {
  id: string;
  folio: string;
  clienteNombre: string;
  clienteTelefono: string;
  /** Desde cuando es cuenta por cobrar. */
  cxcDesde: string;
  /** El reparto en que se entrego. `null` si se recogio en tienda. */
  repartoFolio: string | null;
  estadoPago: EstadoPago;

  // Como se cubrio: lo que vale, lo que puso la billetera, lo que se ha
  // pagado y lo que falta. Ya sumado: la pantalla no hace cuentas.
  total: number;
  pagadoConBilletera: number;
  pagado: number;
  saldo: number;

  productos: {
    nombre: string;
    unidad: string;
    cantidad: number;
    precioUnitario: number;
    importe: number;
  }[];
  pagos: {
    id: string;
    monto: number;
    metodo: MetodoPago;
    nota: string | null;
    registradoPorNombre: string;
    creadoEn: string;
  }[];
}

/** Las pestanas de CXC. */
export enum FiltroCxc {
  CON_SALDO = 'con-saldo',
  COBRADAS = 'cobradas',
}

/**
 * Que es cada pestana, dicho con columnas y no con el saldo: el saldo se
 * calcula en vivo y no se puede filtrar por el. No hace falta, porque el pago
 * que lo deja en cero pasa el pedido a PAGADO en la misma transaccion: una
 * cuenta en CREDITO es una cuenta que debe.
 *
 * Un pedido cancelado no esta en ninguna: ya no se le cobra.
 */
const WHERE_CXC: Record<FiltroCxc, Prisma.PedidoWhereInput> = {
  [FiltroCxc.CON_SALDO]: { cxcDesde: { not: null }, estadoPago: EstadoPago.CREDITO },
  [FiltroCxc.COBRADAS]: {
    cxcDesde: { not: null },
    estadoPago: { in: [EstadoPago.PAGADO, EstadoPago.REEMBOLSADO] },
  },
};

export interface ListadoCxcDto {
  pedidos: PedidoCxcDto[];
  conteos: Record<FiltroCxc, number>;
  /** Lo que se debe entre **todas** las cuentas con saldo, no solo las que viajan. */
  porCobrar: number;
}

const INCLUIR_CXC = {
  cliente: { select: { nombre: true, telefono: true } },
  entregaRuta: { select: { folio: true } },
  items: {
    orderBy: { nombre: 'asc' },
    select: { nombre: true, unidad: true, cantidad: true, precioUnitario: true },
  },
  pagos: {
    orderBy: { creadoEn: 'asc' },
    include: { registradoPor: { select: { nombre: true } } },
  },
} satisfies Prisma.PedidoInclude;

type PedidoConCuenta = Prisma.PedidoGetPayload<{ include: typeof INCLUIR_CXC }>;

/**
 * Administracion -> Finanzas -> CXC: los pedidos que se entregaron a credito y
 * todavia deben, y los pagos con que se van cubriendo.
 *
 * Un pedido entra aqui cuando Finanzas acepta su entrega (o al entregarse, si
 * se recogio en tienda), con `cxcDesde`. De ahi solo sale pagando: cada pago
 * deja su renglon en el libro de ingresos, y el que salda la cuenta deja el
 * pedido pagado por el mismo camino que el boton "Pagado" de Finanzas.
 */
@Injectable()
export class CxcService {
  private readonly logger = new Logger(CxcService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingresos: IngresosService,
    private readonly finanzas: FinanzasService,
  ) {}

  /** Las cuentas de una pestana, de la mas vieja a la mas nueva: la que mas lleva debiendo, arriba. */
  async listar(filtro: FiltroCxc, limite: number): Promise<ListadoCxcDto> {
    const conSaldo = WHERE_CXC[FiltroCxc.CON_SALDO];
    const [pedidos, valen, pagado, ...cuentas] = await Promise.all([
      this.prisma.pedido.findMany({
        where: WHERE_CXC[filtro],
        orderBy: { cxcDesde: filtro === FiltroCxc.CON_SALDO ? 'asc' : 'desc' },
        take: limite,
        include: INCLUIR_CXC,
      }),
      // El total por cobrar se suma en la base sobre todas las cuentas: con
      // los renglones que viajan saldria corto en cuanto pasen del limite.
      this.prisma.pedido.aggregate({
        where: conSaldo,
        _sum: { total: true, pagadoConBilletera: true },
      }),
      this.prisma.pagoPedido.aggregate({ where: { pedido: conSaldo }, _sum: { monto: true } }),
      ...Object.values(FiltroCxc).map((f) => this.prisma.pedido.count({ where: WHERE_CXC[f] })),
    ]);
    const conteos = Object.fromEntries(
      Object.values(FiltroCxc).map((f, i) => [f, cuentas[i]]),
    ) as Record<FiltroCxc, number>;

    const cero = new Decimal(0);
    const porCobrar = (valen._sum.total ?? cero)
      .sub(valen._sum.pagadoConBilletera ?? cero)
      .sub(pagado._sum.monto ?? cero);

    return {
      pedidos: pedidos.map((p) => CxcService.aDto(p)),
      conteos,
      porCobrar: Decimal.max(0, porCobrar).toNumber(),
    };
  }

  /**
   * Registra un pago a una cuenta por cobrar. Todo en una transaccion, con el
   * pedido bloqueado:
   *
   *  1. El pago queda escrito con su monto, su metodo y quien lo recibio.
   *  2. Deja su renglon en el libro de ingresos, con concepto CXC y el folio
   *     del pedido.
   *  3. Si con el la cuenta queda en cero, el pedido pasa a PAGADO y gana su
   *     cashback (`FinanzasService.marcarPagado`).
   *
   * Un pago no puede pasar de lo que se debe: salda la cuenta, no crea saldo a
   * favor.
   */
  async registrarPago(
    pedidoId: string,
    dto: RegistrarPagoDto,
    usuario: UsuarioAutenticado,
  ): Promise<PedidoCxcDto> {
    const quien = actorDe(usuario);

    await this.prisma.$transaction(async (tx) => {
      // Bloqueado: dos pagos a la vez leerian el mismo saldo y juntos lo pasarian.
      await FlujoPedidosService.bloquearFila(tx, pedidoId);
      const pedido = await tx.pedido.findUnique({
        where: { id: pedidoId },
        select: {
          folio: true,
          estadoPago: true,
          cxcDesde: true,
          total: true,
          pagadoConBilletera: true,
          pagos: { select: { monto: true } },
        },
      });
      if (!pedido) throw new NotFoundException('Pedido no encontrado');

      if (pedido.cxcDesde === null || pedido.estadoPago !== EstadoPago.CREDITO) {
        throw new ConflictException({
          statusCode: 409,
          code: 'NO_ES_CXC',
          message:
            pedido.cxcDesde !== null && pedido.estadoPago === EstadoPago.PAGADO
              ? 'Esa cuenta ya está cobrada.'
              : 'Ese pedido no es una cuenta por cobrar.',
        });
      }

      const monto = new Decimal(dto.monto);
      if (!pagoCabe(pedido, monto)) {
        throw new ConflictException({
          statusCode: 409,
          code: 'PAGO_EXCEDE_SALDO',
          message: `El pago pasa de lo que se debe: quedan $${saldoDelPedido(pedido).toFixed(2)}.`,
        });
      }

      const pago = await tx.pagoPedido.create({
        data: {
          pedidoId,
          monto,
          metodo: dto.metodo,
          nota: dto.nota?.trim() || null,
          registradoPorId: usuario.sub,
        },
      });
      await this.ingresos.registrar(tx, {
        concepto: ConceptoIngreso.CXC,
        referencia: pedido.folio,
        monto,
        metodo: dto.metodo,
        nota: pago.nota,
        registradoPorId: usuario.sub,
        pagoPedidoId: pago.id,
      });

      const saldo = saldoDelPedido({ ...pedido, pagos: [...pedido.pagos, { monto }] });
      if (saldo.isZero()) {
        await this.finanzas.marcarPagado(tx, pedidoId, quien, 'Cuenta por cobrar saldada.');
      }

      this.logger.log(
        `Pago de $${monto.toFixed(2)} al pedido ${pedido.folio} por ${usuario.nombre}: ` +
          (saldo.isZero() ? 'cuenta saldada' : `quedan $${saldo.toFixed(2)}`),
      );
    });

    const pedido = await this.prisma.pedido.findUniqueOrThrow({
      where: { id: pedidoId },
      include: INCLUIR_CXC,
    });
    return CxcService.aDto(pedido);
  }

  private static aDto(pedido: PedidoConCuenta): PedidoCxcDto {
    return {
      id: pedido.id,
      folio: pedido.folio,
      clienteNombre: pedido.cliente.nombre,
      clienteTelefono: pedido.cliente.telefono,
      // Solo llegan pedidos con `cxcDesde`: lo dice el filtro de quien llama.
      cxcDesde: (pedido.cxcDesde ?? pedido.creadoEn).toISOString(),
      repartoFolio: pedido.entregaRuta?.folio ?? null,
      estadoPago: pedido.estadoPago,
      total: pedido.total.toNumber(),
      pagadoConBilletera: pedido.pagadoConBilletera.toNumber(),
      pagado: pagadoDelPedido(pedido).toNumber(),
      saldo: saldoDelPedido(pedido).toNumber(),
      // Un renglon en cero es lo que el cliente no acepto: no se le cobra.
      productos: pedido.items
        .filter((item) => item.cantidad > 0)
        .map((item) => ({
          nombre: item.nombre,
          unidad: item.unidad,
          cantidad: item.cantidad,
          precioUnitario: item.precioUnitario.toNumber(),
          importe: item.precioUnitario.mul(item.cantidad).toNumber(),
        })),
      pagos: pedido.pagos.map((pago) => ({
        id: pago.id,
        monto: pago.monto.toNumber(),
        metodo: pago.metodo,
        nota: pago.nota,
        registradoPorNombre: pago.registradoPor.nombre,
        creadoEn: pago.creadoEn.toISOString(),
      })),
    };
  }
}
