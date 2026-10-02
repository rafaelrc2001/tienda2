import { Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * Las cuentas de una cuenta por cobrar: cuanto debe todavia un pedido que se
 * entrego a credito.
 *
 * Funciones puras, sin base de datos. El saldo no se guarda en ninguna columna:
 * se calcula en vivo de lo que el pedido vale y de lo que ya se le ha pagado,
 * igual que los contadores de cupones. Una columna de saldo seria un segundo
 * numero que mantener de acuerdo con sus pagos.
 */

/**
 * Por debajo de medio centavo el pedido ya no debe nada. Los montos son
 * Decimal y no dejan colas, pero las pantallas los reciben como numero: sin
 * esto un redondeo de ellas pintaria un saldo fantasma.
 */
export const TOLERANCIA = new Decimal('0.005');

/** Lo minimo del pedido que decide cuanto debe. */
export interface PedidoPorCobrar {
  total: Decimal;
  /** Lo que el cliente ya pago con su saldo de cashback al confirmar. */
  pagadoConBilletera: Decimal;
  /** Los pagos que ya se le registraron. */
  pagos: { monto: Decimal }[];
}

/** La suma de lo que ya se le ha pagado, sin contar la billetera. */
export function pagadoDelPedido(pedido: Pick<PedidoPorCobrar, 'pagos'>): Decimal {
  return pedido.pagos.reduce((suma, pago) => suma.add(pago.monto), new Decimal(0));
}

/**
 * Lo que el pedido debe todavia: lo que vale, menos lo que cubrio la billetera
 * y menos sus pagos. Nunca negativo: pagar de mas no deja saldo a favor.
 *
 * El `total` ya es lo que el cliente se quedo: una entrega parcial deja el
 * pedido como se entrego, asi que aqui no hay nada que descontar por lo que no
 * acepto.
 */
export function saldoDelPedido(pedido: PedidoPorCobrar): Decimal {
  const saldo = new Decimal(pedido.total)
    .sub(pedido.pagadoConBilletera)
    .sub(pagadoDelPedido(pedido));
  return saldo.lte(TOLERANCIA) ? new Decimal(0) : saldo;
}

/**
 * Si un pago cabe en lo que el pedido debe. Un pago salda la cuenta, no crea
 * saldo a favor: lo que sobre no tiene donde quedar escrito.
 */
export function pagoCabe(pedido: PedidoPorCobrar, monto: Decimal): boolean {
  return monto.lte(saldoDelPedido(pedido).add(TOLERANCIA));
}
