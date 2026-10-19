import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EjeBitacora, EstadoPago, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { CashbackService } from '../cashback/cashback.service';
import { InventarioService } from '../inventario/inventario.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { importeDeLinea } from '../catalogo/precios';
import { ActorDeBitacora, actorDe, registrarEnBitacora } from './bitacora';
import { pagadoDelPedido } from './cxc';
import { totalRedondeado } from './redondeo';
import {
  BloqueoPago,
  bloqueoDeCambioDePrecio,
  bloqueoDeCancelacion,
  BotonPago,
  botonesDePago,
  evaluarCambioPago,
  NOMBRE_ESTADO_PAGO,
} from './flujo-pago';
import { FlujoPedidosService } from './flujo-pedidos.service';
import { PedidoDto, PedidosService } from './pedidos.service';

const Decimal = Prisma.Decimal;

/**
 * Un pedido como lo ve Finanzas: con sus siete botones resueltos y si se le
 * puede cambiar el precio a sus productos (`null`) o por que no.
 */
export type PedidoEnFinanzasDto = PedidoDto & {
  botones: BotonPago[];
  bloqueoPrecio: BloqueoPago | null;
};

/** Las pestanas de Finanzas, por lo que Finanzas tiene que hacer con el pedido. */
export enum FiltroFinanzas {
  /** El dinero no esta confirmado: pendiente, o retenido por Finanzas. */
  POR_DECIDIR = 'por-decidir',
  /** Se entrega sin cobrar: el cliente paga despues. */
  CREDITO = 'credito',
  PAGADOS = 'pagados',
  CANCELADOS = 'cancelados',
  /** Todos, del mas reciente al mas viejo: la pantalla busca sobre ellos. */
  TODOS = 'todos',
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
  [FiltroFinanzas.TODOS]: {},
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
    private readonly configuracion: ConfiguracionService,
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
      botones: botonesDePago({
        estado: pedido.estado,
        estadoPago: pedido.pago.estado,
        enCxc: pedido.pago.enCxc,
      }),
      bloqueoPrecio: bloqueoDeCambioDePrecio({
        estado: pedido.estado,
        estadoPago: pedido.pago.estado,
        metodoPago: pedido.pago.metodo,
        facturado: pedido.factura !== null,
      }),
    };
  }

  /**
   * Le pone a un producto de este pedido otro precio por pieza: el que se le
   * pacto a este cliente. Es lo que se cobra, asi que con el renglon cambia
   * todo lo que colgaba del total, en la misma transaccion y como en una
   * entrega parcial (`dejarComoSeEntrego`):
   *  - subtotal y total suben o bajan la diferencia; envio, recargo y cupon
   *    no se tocan (el envio gratis ya se gano o no al comprar). El redondeo
   *    del efectivo se vuelve a sacar sobre el total nuevo;
   *  - si el total baja de lo que pago con su billetera, el sobrante vuelve;
   *  - el cashback se recalcula con el % congelado. Todavia no esta en la
   *    billetera: eso pasa al quedar PAGADO, y pagado ya no se cambia;
   *  - `totalGastado` se mueve lo mismo y el nivel se recalcula.
   *
   * Una cuenta por cobrar no puede quedar debiendo menos de lo que ya abono:
   * ese dinero no tendria donde quedar escrito.
   */
  async cambiarPrecio(
    pedidoId: string,
    itemId: string,
    precio: number,
    usuario: UsuarioAutenticado,
    nota?: string,
  ): Promise<PedidoEnFinanzasDto> {
    const config = await this.configuracion.obtener();

    await this.prisma.$transaction(async (tx) => {
      await FlujoPedidosService.bloquearFila(tx, pedidoId);
      const pedido = await tx.pedido.findUniqueOrThrow({
        where: { id: pedidoId },
        select: {
          folio: true,
          clienteId: true,
          estado: true,
          estadoPago: true,
          metodoPago: true,
          subtotal: true,
          total: true,
          redondeo: true,
          pagadoConBilletera: true,
          pagoCon: true,
          porcentajeCashback: true,
          factura: { select: { id: true } },
          pagos: { select: { monto: true } },
          items: {
            select: {
              id: true,
              nombre: true,
              cantidad: true,
              precioUnitario: true,
              precioOriginal: true,
              producto: { select: { aplicaCashback: true } },
            },
          },
        },
      });

      const bloqueo = bloqueoDeCambioDePrecio({ ...pedido, facturado: pedido.factura !== null });
      if (bloqueo) {
        throw new ConflictException({
          statusCode: 409,
          code: bloqueo.codigo,
          message: bloqueo.mensaje,
        });
      }

      // El renglon que el cliente no acepto en la puerta ya no es parte del pedido.
      const item = pedido.items.find((i) => i.id === itemId && i.cantidad > 0);
      if (!item) throw new NotFoundException('Ese producto no está en el pedido');

      const nuevo = new Decimal(precio);
      if (nuevo.equals(item.precioUnitario)) {
        throw new ConflictException({
          statusCode: 409,
          code: 'MISMO_PRECIO',
          message: 'Ese ya es el precio del producto en este pedido.',
        });
      }

      const diferencia = importeDeLinea(nuevo, item.cantidad).sub(
        importeDeLinea(item.precioUnitario, item.cantidad),
      );
      // El redondeo del efectivo era sobre el total de antes: se saca otra vez.
      const { total, redondeo, pagadoConBilletera } = totalRedondeado(
        pedido.total.sub(pedido.redondeo).add(diferencia),
        pedido.pagadoConBilletera,
        pedido.metodoPago,
      );
      const billeteraDevuelta = pedido.pagadoConBilletera.sub(pagadoConBilletera);
      const aPagar = total.sub(pagadoConBilletera);

      const abonado = pagadoDelPedido(pedido);
      if (abonado.greaterThan(aPagar)) {
        throw new ConflictException({
          statusCode: 409,
          code: 'PRECIO_BAJO_ABONADO',
          message:
            `El cliente ya abonó $${abonado.toFixed(2)}: con ese precio el pedido ` +
            `quedaría en $${aPagar.toFixed(2)}.`,
        });
      }

      await tx.pedidoItem.update({
        where: { id: item.id },
        // El original es el primero: un segundo cambio no lo pisa.
        data: { precioUnitario: nuevo, precioOriginal: item.precioOriginal ?? item.precioUnitario },
      });

      const base = pedido.items
        .filter((i) => i.producto.aplicaCashback)
        .reduce(
          (suma, i) =>
            suma.add(importeDeLinea(i.id === item.id ? nuevo : i.precioUnitario, i.cantidad)),
          new Decimal(0),
        );
      const cashback = CashbackService.aBilletera(
        CashbackService.calcular(base, pedido.porcentajeCashback, config.montoMinimoCashback),
        config.multiplicadorCashback,
      );

      await tx.pedido.update({
        where: { id: pedidoId },
        data: {
          subtotal: Decimal.max(0, pedido.subtotal.add(diferencia)),
          total,
          redondeo,
          pagadoConBilletera,
          // El cambio que se aviso al comprar era sobre el total de entonces.
          cambio: pedido.pagoCon ? Decimal.max(0, pedido.pagoCon.sub(aPagar)) : null,
          cashbackGenerado: cashback,
        },
      });

      // El saldo se bloquea antes de tocarlo, igual que en el checkout.
      const filas = await tx.$queryRaw<{ saldoCashback: Prisma.Decimal }[]>`
        SELECT "saldoCashback" FROM clientes WHERE id = ${pedido.clienteId} FOR UPDATE
      `;
      let saldo = new Decimal(filas[0]?.saldoCashback ?? 0);
      if (billeteraDevuelta.greaterThan(0)) {
        await tx.movimientoCashback.create({
          data: {
            clienteId: pedido.clienteId,
            pedidoId,
            monto: billeteraDevuelta,
            concepto: `Devolución de billetera: bajó el precio en el pedido ${pedido.folio}`,
          },
        });
        saldo = saldo.add(billeteraDevuelta);
      }
      const cliente = await tx.cliente.update({
        where: { id: pedido.clienteId },
        data: { saldoCashback: saldo, totalGastado: { increment: total.sub(pedido.total) } },
      });
      await this.cashback.recalcularNivel(tx, pedido.clienteId, cliente.totalGastado);

      // Un renglon en el eje del pago, sin cambiar de estatus: es su dinero el que se movio.
      await registrarEnBitacora(
        tx,
        pedidoId,
        {
          eje: EjeBitacora.PAGO,
          estadoAnterior: pedido.estadoPago,
          estadoNuevo: pedido.estadoPago,
          nota: [
            `Precio de ${item.nombre}: $${item.precioUnitario.toFixed(2)} → ` +
              `$${nuevo.toFixed(2)} por pieza. Total $${pedido.total.toFixed(2)} → ` +
              `$${total.toFixed(2)}.`,
            nota?.trim(),
          ]
            .filter(Boolean)
            .join(' '),
        },
        actorDe(usuario),
      );

      this.logger.log(
        `Pedido ${pedido.folio}: ${usuario.nombre} cambió el precio de ${item.nombre} ` +
          `a $${nuevo.toFixed(2)} (total $${total.toFixed(2)}).`,
      );
    });

    return FinanzasService.enPantalla(await this.pedidos.detalle(pedidoId));
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
          cxcDesde: true,
        },
      });

      const resultado = evaluarCambioPago(
        {
          ...pedido,
          enCxc: pedido.cxcDesde !== null && pedido.estadoPago === EstadoPago.CREDITO,
        },
        destino,
        Boolean(nota?.trim()),
      );
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

      await this.aplicarPago(tx, pedido, destino, quien, nota);

      if (destino === EstadoPago.CANCELADO) {
        await this.deshacer(tx, pedido, quien);
      }
    });

    return FinanzasService.enPantalla(await this.pedidos.detalle(id));
  }

  /**
   * Cancela un pedido desde fuera de Finanzas: el cliente desde Mis Pedidos, o
   * la tienda cuando el cliente ya no pasa a recogerlo.
   *
   * Es el mismo camino que el boton "Cancelado" de Finanzas —estatus, renglon
   * de bitacora y `deshacer()`—, con el candado mas estricto de
   * `bloqueoDeCancelacion` (lo ya cobrado lo reembolsa Finanzas).
   *
   * `de` acota a quien le toca: el cliente solo cancela los suyos y la tienda
   * solo los que se recogen en ella. Si no es asi, 404, como si no existiera.
   */
  async cancelar(
    id: string,
    de: { clienteId: string } | { tiendaId: string },
    usuario: UsuarioAutenticado,
    nota?: string,
  ): Promise<void> {
    const quien = actorDe(usuario);

    await this.prisma.$transaction(async (tx) => {
      await FlujoPedidosService.bloquearFila(tx, id);
      const pedido = await tx.pedido.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          folio: true,
          clienteId: true,
          tiendaId: true,
          estado: true,
          estadoPago: true,
          total: true,
          pagadoConBilletera: true,
          cashbackGenerado: true,
          cashbackAcreditadoEn: true,
        },
      });

      const ajeno =
        'clienteId' in de ? pedido.clienteId !== de.clienteId : pedido.tiendaId !== de.tiendaId;
      if (ajeno) throw new NotFoundException('Pedido no encontrado');

      const bloqueo = bloqueoDeCancelacion(pedido);
      if (bloqueo) {
        throw new ConflictException({
          statusCode: 409,
          code: bloqueo.codigo,
          message: bloqueo.mensaje,
        });
      }

      await this.aplicarPago(tx, pedido, EstadoPago.CANCELADO, quien, nota);
      await this.deshacer(tx, pedido, quien);
    });
  }

  /**
   * Deja pagado un pedido desde otra transaccion: la de "Entrega aceptada",
   * que paga los pedidos en efectivo de un corte, y la del pago que salda una
   * cuenta por cobrar.
   *
   * Es el mismo camino que pulsar "Pagado" en Finanzas —el estatus, su renglon
   * de bitacora y el cashback—, sin sus candados de pantalla: aqui no decide
   * una persona, es la consecuencia de un dinero que ya se acepto.
   *
   * Idempotente. Un pedido que ya esta pagado no se toca, y uno cancelado
   * tampoco: su inventario ya volvio y su saldo ya se devolvio. Devuelve si lo
   * dejo pagado, para quien quiera contarlos.
   */
  async marcarPagado(
    tx: Prisma.TransactionClient,
    pedidoId: string,
    quien: ActorDeBitacora,
    nota?: string,
  ): Promise<boolean> {
    await FlujoPedidosService.bloquearFila(tx, pedidoId);
    const pedido = await tx.pedido.findUniqueOrThrow({
      where: { id: pedidoId },
      select: { id: true, estadoPago: true },
    });
    if (pedido.estadoPago === EstadoPago.PAGADO || pedido.estadoPago === EstadoPago.CANCELADO) {
      return false;
    }

    await this.aplicarPago(tx, pedido, EstadoPago.PAGADO, quien, nota);
    return true;
  }

  /**
   * Escribe el cambio de estatus, con la fila ya bloqueada y la decision ya
   * tomada: el estatus, su renglon de bitacora y, si queda pagado, el cashback.
   */
  private async aplicarPago(
    tx: Prisma.TransactionClient,
    pedido: { id: string; estadoPago: EstadoPago },
    destino: EstadoPago,
    quien: ActorDeBitacora,
    nota?: string,
  ): Promise<void> {
    // El estado de origen viaja en el `where` como ultima red: si alguien
    // cambio el pago entre el bloqueo y esto, no se pisa su decision.
    const { count } = await tx.pedido.updateMany({
      where: { id: pedido.id, estadoPago: pedido.estadoPago },
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
      pedido.id,
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
      await this.cashback.acreditarPedido(tx, pedido.id);
    }
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
