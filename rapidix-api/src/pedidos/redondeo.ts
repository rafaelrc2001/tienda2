import { MetodoPago, Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * Redondeo del efectivo: lo que se cobra en efectivo va en pesos enteros,
 * hacia arriba ($22.27 y $22.83 se cobran $23). Ni el repartidor ni la caja
 * pueden dar cambio en centavos.
 *
 * Solo la parte en efectivo: lo que cubre la billetera no se redondea, porque
 * gastaria saldo de mas. La transferencia tampoco, que si admite centavos.
 *
 * Funciones puras. El redondeo se guarda en su columna (`Pedido.redondeo`) y
 * entra al `total`, asi que la hoja del repartidor, el corte, la CXC y la
 * factura lo cuentan sin saber que existe.
 */

/** Lo que hay que sumar a `aPagar` para que quede en el siguiente peso entero. */
export function redondeoDelEfectivo(metodo: MetodoPago | undefined, aPagar: Decimal): Decimal {
  if (metodo !== MetodoPago.EFECTIVO || !aPagar.greaterThan(0)) return new Decimal(0);
  return aPagar.ceil().sub(aPagar);
}

/**
 * El total de un pedido cuyo valor cambio (entrega parcial, precio pactado),
 * con la billetera acotada y el redondeo vuelto a calcular sobre lo que queda.
 *
 * `base` es lo que vale ahora el pedido **sin** redondeo: el redondeo de antes
 * ya no sirve, porque se calculo sobre otro monto.
 */
export function totalRedondeado(
  base: Decimal,
  billeteraAntes: Decimal,
  metodo: MetodoPago,
): { total: Decimal; redondeo: Decimal; pagadoConBilletera: Decimal } {
  const sinRedondeo = Decimal.max(0, base);
  const pagadoConBilletera = Decimal.min(billeteraAntes, sinRedondeo);
  const redondeo = redondeoDelEfectivo(metodo, sinRedondeo.sub(pagadoConBilletera));
  return { total: sinRedondeo.add(redondeo), redondeo, pagadoConBilletera };
}
