import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { EjeBitacora, EstadoPago, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { CashbackService } from '../cashback/cashback.service';
import { InventarioService } from '../inventario/inventario.service';
import { ActorDeBitacora, actorDe, registrarEnBitacora } from './bitacora';
import { BotonPago, botonesDePago, evaluarCambioPago, NOMBRE_ESTADO_PAGO } from './flujo-pago';
import { FlujoPedidosService } from './flujo-pedidos.service';
import { PedidoDto, PedidosService } from './pedidos.service';

const Decimal = Prisma.Decimal;

/** Un pedido como lo ve Finanzas: con sus siete botones resueltos. */
export type PedidoEnFinanzasDto = PedidoDto & { botones: BotonPago[] };

/** Las pestanas de Finanzas, por lo que Finanzas tiene que hacer con el pedido. */
export enum FiltroFinanzas {
  /** El dinero no esta confirmado: pendiente, o retenido por Finanzas. */
  POR_DECIDIR = 'por-decidir',
  /** Se entrega sin cobrar: el cliente paga despues. */
  CREDITO = 'credito',
  PAGADOS = 'pagados',
  CANCELADOS = 'cancelados',
}

const WHERE_FINANZAS: Record<FiltroFinanzas, Prisma.PedidoWhereInput> = {
  [FiltroFinanzas.POR_DECIDIR]: {
    estadoPago: { in: [EstadoPago.PAGO_PENDIENTE, EstadoPago.RETENER] },
  },
  [FiltroFinanzas.CREDITO]: { estadoPago: EstadoPago.CREDITO },
  [FiltroFinanzas.PAGADOS]: {
    estadoPago: { in: [EstadoPago.PAGADO, EstadoPago.REEMBOLSADO] },
  },
  [FiltroFinanzas.CANCELADOS]: { estadoPago: EstadoPago.CANCELADO },
};

export interface ListadoFinanzasDto {
  pedidos: PedidoEnFinanzasDto[];
  /** Cuantos hay en cada pestana, para pintarlo junto a su nombre. */
  conteos: Record<FiltroFinanzas, number>;
}

/**
 * Administracion -> Finanzas: el eje del dinero.
 *
 * Las reglas de que se puede pulsar viven en `flujo-pago.ts`; aqui se aplican
 * con la fila bloqueada y se encadenan los efectos de cada estatus, todo en la
 * misma transaccion que el cambio.
 */
@Injectable()
export class FinanzasService {
  private readonly logger = new Logger(FinanzasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pedidos: PedidosService,
    private readonly cashback: CashbackService,
    private readonly inventario: InventarioService,
  ) {}

  /** La pantalla de Finanzas: lo mas reciente primero, que es lo que se revisa. */
  async listar(filtro: FiltroFinanzas, limite: number): Promise<ListadoFinanzasDto> {
    const [pedidos, ...cuentas] = await Promise.all([
      this.pedidos.buscar(WHERE_FINANZAS[filtro], { creadoEn: 'desc' }, limite),
      ...Object.values(FiltroFinanzas).map((f) =>
        this.prisma.pedido.count({ where: WHERE_FINANZAS[f] }),
      ),
    ]);
    const conteos = Object.fromEntries(
      Object.values(FiltroFinanzas).map((f, i) => [f, cuentas[i]]),
    ) as Record<FiltroFinanzas, number>;

    return { pedidos: pedidos.map((p) => FinanzasService.enPantalla(p)), conteos };
  }

  /** Le pone al pedido sus botones, calculados aqui y no en la interfaz. */
  static enPantalla(pedido: PedidoDto): PedidoEnFinanzasDto {
    return {
      ...pedido,
      botones: botonesDePago({ estado: pedido.estado, estadoPago: pedido.pago.estado }),
    };
  }

  /**
   * Deja el pedido en el estatus de pago que decide Finanzas, con lo que ese
   * estatus arrastre: acreditar el cashback al pagarse, deshacer el pedido al
   * cancelarlo.
   *
   * La fila se bloquea antes de leer nada: sin eso, Operaciones podria avanzar
   * el pedido entre la lectura y la escritura y se cancelaria mercancia que ya
   * va en el camion.
   */
  async cambiarPago(
    id: string,
    destino: EstadoPago,
    usuario: UsuarioAutenticado,
    nota?: string,
  ): Promise<PedidoEnFinanzasDto> {
    const quien = actorDe(usuario);

    await this.prisma.$transaction(async (tx) => {
      await FlujoPedidosService.bloquearFila(tx, id);
      const pedido = await tx.pedido.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          folio: true,
          clienteId: true,
          estado: true,
          estadoPago: true,
          total: true,
          pagadoConBilletera: true,
          cashbackGenerado: true,
          cashbackAcreditadoEn: true,
        },
      });

      const resultado = evaluarCambioPago(pedido, destino, Boolean(nota?.trim()));
      if ('bloqueo' in resultado) {
        throw new ConflictException({
          statusCode: 409,
          code: resultado.bloqueo.codigo,
          message: resultado.bloqueo.mensaje,
        });
      }

      // Aclarar el motivo de una cancelacion no repite sus efectos: el
      // inventario ya volvio y el saldo ya se devolvio. Solo deja el renglon.
      if (resultado.accion === 'aclaracion') {
        await registrarEnBitacora(
          tx,
          id,
          {
            eje: EjeBitacora.PAGO,
            estadoAnterior: EstadoPago.CANCELADO,
            estadoNuevo: EstadoPago.CANCELADO,
            nota,
          },
          quien,
        );
        return;
      }

      // El estado de origen viaja en el `where` como ultima red: si alguien
      // cambio el pago entre el bloqueo y esto, no se pisa su decision.
      const { count } = await tx.pedido.updateMany({
        where: { id, estadoPago: pedido.estadoPago },
        data: {
          estadoPago: destino,
          ...(destino === EstadoPago.PAGADO && { pagoValidadoEn: new Date() }),
        },
      });
      if (count === 0) {
        throw new ConflictException({
          statusCode: 409,
          code: 'PEDIDO_CAMBIO',
          message: 'El pedido cambió mientras tanto. Actualiza la pantalla.',
        });
      }

      await registrarEnBitacora(
        tx,
        id,
        {
          eje: EjeBitacora.PAGO,
          estadoAnterior: pedido.estadoPago,
          estadoNuevo: destino,
          nota,
        },
        quien,
      );

      if (destino === EstadoPago.PAGADO) {
        // Idempotente: un pedido que ya paso por PAGADO no vuelve a acreditar.
        await this.cashback.acreditarPedido(tx, id);
      }
      if (destino === EstadoPago.CANCELADO) {
        await this.deshacer(tx, pedido, quien);
      }
    });

    return FinanzasService.enPantalla(await this.pedidos.detalle(id));
  }

  /**
   * Deshace lo que el pedido movio, al cancelarlo. En el mismo orden en que el
   * checkout lo hizo, a la inversa:
   *
   *  1. La mercancia regresa a bodega (solo la que de verdad salio).
   *  2. El saldo de billetera que gasto vuelve a su billetera.
   *  3. El cashback que le acredito el pedido se retira.
   *  4. El pedido deja de contar como gasto, y su nivel se recalcula.
   *
   * Lo que **no** se deshace es el cupon: sigue en USED. Devolverlo abriria la
   * puerta a pedir y cancelar para reciclarlo, y `usedPedidoId` es unico a
   * proposito. Si el cliente lo merece, Cupones puede emitirle otro.
   */
  private async deshacer(
    tx: Prisma.TransactionClient,
    pedido: {
      id: string;
      folio: string;
      clienteId: string;
      total: Prisma.Decimal;
      pagadoConBilletera: Prisma.Decimal;
      cashbackGenerado: Prisma.Decimal;
      cashbackAcreditadoEn: Date | null;
    },
    quien: ActorDeBitacora,
  ): Promise<void> {
    const piezas = await this.inventario.devolverPedido(tx, pedido.id, pedido.folio, {
      usuarioId: quien.actorId,
      usuarioNombre: quien.actorNombre,
    });

    // El saldo se bloquea antes de tocarlo, igual que en el checkout: aqui
    // entra y sale dinero de la misma fila que otro pedido podria estar
    // gastando ahora mismo.
    const filas = await tx.$queryRaw<{ saldoCashback: Prisma.Decimal }[]>`
      SELECT "saldoCashback" FROM clientes WHERE id = ${pedido.clienteId} FOR UPDATE
    `;
    let saldo = new Decimal(filas[0]?.saldoCashback ?? 0);

    if (pedido.pagadoConBilletera.greaterThan(0)) {
      await tx.movimientoCashback.create({
        data: {
          clienteId: pedido.clienteId,
          pedidoId: pedido.id,
          monto: pedido.pagadoConBilletera,
          concepto: `Devolución por el pedido ${pedido.folio} cancelado`,
        },
      });
      saldo = saldo.add(pedido.pagadoConBilletera);
    }

    // Si el pedido llego a pagarse, su cashback ya esta en la billetera y deja
    // de corresponder. Se retira lo que quede: nunca mas de lo que hay, porque
    // un saldo negativo le cobraria al cliente en su siguiente compra un
    // premio que ya se gasto. Lo que no alcanzo queda en el log, no en su
    // contra.
    if (pedido.cashbackAcreditadoEn && pedido.cashbackGenerado.greaterThan(0)) {
      const retirable = Decimal.min(pedido.cashbackGenerado, Decimal.max(saldo, 0));
      if (retirable.greaterThan(0)) {
        await tx.movimientoCashback.create({
          data: {
            clienteId: pedido.clienteId,
            pedidoId: pedido.id,
            monto: retirable.negated(),
            concepto: `Cashback retirado: el pedido ${pedido.folio} se canceló`,
          },
        });
        saldo = saldo.sub(retirable);
      }
      if (retirable.lessThan(pedido.cashbackGenerado)) {
        this.logger.warn(
          `Pedido ${pedido.folio} cancelado: no se pudo retirar todo el cashback ` +
            `(${pedido.cashbackGenerado.toString()}), el cliente ya lo había gastado.`,
        );
      }
    }

    // Un pedido cancelado no es gasto: ni cuenta para el nivel ni para los
    // contadores del perfil. `ultimoPedido` y `primerPedido` no se tocan: son
    // marcas de cuando el cliente estuvo activo, y eso si ocurrio.
    const cliente = await tx.cliente.update({
      where: { id: pedido.clienteId },
      data: {
        saldoCashback: saldo,
        pedidos: { decrement: 1 },
        totalGastado: { decrement: pedido.total },
      },
    });
    await this.cashback.recalcularNivel(tx, pedido.clienteId, cliente.totalGastado);

    this.logger.log(
      `Pedido ${pedido.folio} cancelado: ${piezas} pieza(s) a bodega, ` +
        `$${pedido.pagadoConBilletera.toString()} de billetera devueltos.`,
    );
  }

  /** Nombre legible de un estatus, para los mensajes de quien lo cambia. */
  static nombre(estado: EstadoPago): string {
    return NOMBRE_ESTADO_PAGO[estado];
  }
}
