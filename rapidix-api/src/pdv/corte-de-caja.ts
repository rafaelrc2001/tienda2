import { EstadoPago, EstadoPedido, MetodoEntrega, MetodoPago, Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * Las cuentas del corte de caja de un turno. Funciones puras, sin base de
 * datos, para que el turno abierto y el corte ya cerrado digan lo mismo.
 */

/** Lo minimo de un pedido que hace falta para contarlo en caja. */
export interface PedidoDelTurno {
  estado: EstadoPedido;
  estadoPago: EstadoPago;
  metodoPago: MetodoPago;
  metodoEntrega: MetodoEntrega;
  total: Decimal;
  pagadoConBilletera: Decimal;
}

export interface TotalesDelTurno {
  /** Todos los que se capturaron en el turno, cancelados incluidos. */
  pedidos: number;
  /** Entregados y cobrados en el mostrador: son los que suman a la caja. */
  cobrados: number;
  /** Confirmados para llevar que nadie ha entregado: impiden cerrar el turno. */
  porEntregar: number;
  /** Se capturaron aqui pero salen por Rutas: su dinero no pasa por esta caja. */
  aDomicilio: number;
  cancelados: number;
  /** Lo que valen los cobrados. */
  ventas: Decimal;
  efectivo: Decimal;
  transferencia: Decimal;
  billetera: Decimal;
}

/**
 * Si el pedido se entrego y se cobro en el mostrador.
 *
 * El que va a domicilio no cuenta aunque se haya capturado en el turno: lo
 * cobra el repartidor y entra a su corte, y contarlo aqui lo sumaria dos
 * veces. Tampoco el que se entrego a credito: nadie pago nada en caja.
 */
export function cobradoEnCaja(pedido: PedidoDelTurno): boolean {
  return (
    pedido.metodoEntrega === MetodoEntrega.TIENDA &&
    pedido.estado === EstadoPedido.ENTREGADO &&
    pedido.estadoPago === EstadoPago.PAGADO
  );
}

/** Para llevar, vivo y todavia en el mostrador. */
export function porEntregarEnCaja(pedido: PedidoDelTurno): boolean {
  return (
    pedido.metodoEntrega === MetodoEntrega.TIENDA &&
    pedido.estado !== EstadoPedido.ENTREGADO &&
    pedido.estadoPago !== EstadoPago.CANCELADO
  );
}

export function totalesDelTurno(pedidos: PedidoDelTurno[]): TotalesDelTurno {
  const totales: TotalesDelTurno = {
    pedidos: pedidos.length,
    cobrados: 0,
    porEntregar: 0,
    aDomicilio: 0,
    cancelados: 0,
    ventas: new Decimal(0),
    efectivo: new Decimal(0),
    transferencia: new Decimal(0),
    billetera: new Decimal(0),
  };

  for (const pedido of pedidos) {
    if (pedido.estadoPago === EstadoPago.CANCELADO) {
      totales.cancelados++;
      continue;
    }
    if (pedido.metodoEntrega === MetodoEntrega.DOMICILIO) {
      totales.aDomicilio++;
      continue;
    }
    if (porEntregarEnCaja(pedido)) {
      totales.porEntregar++;
      continue;
    }
    if (!cobradoEnCaja(pedido)) continue;

    // La billetera no es un metodo: se combina con cualquiera de los dos, y lo
    // que queda es lo que entro por el metodo elegido.
    const cobrado = pedido.total.sub(pedido.pagadoConBilletera);
    totales.cobrados++;
    totales.ventas = totales.ventas.add(pedido.total);
    totales.billetera = totales.billetera.add(pedido.pagadoConBilletera);
    if (pedido.metodoPago === MetodoPago.EFECTIVO) {
      totales.efectivo = totales.efectivo.add(cobrado);
    } else {
      totales.transferencia = totales.transferencia.add(cobrado);
    }
  }
  return totales;
}
