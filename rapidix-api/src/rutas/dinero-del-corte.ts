import { EstadoPago, MetodoPago, Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * Cuanto dinero trae el repartidor por cada pedido que entrego.
 *
 * Funciones puras, sin base de datos: el corte las usa para calcular lo que
 * debe entregar y la pantalla recibe el numero ya hecho. Un solo sitio, para
 * que lo que se le pide al repartidor y lo que Finanzas espera contar no
 * puedan discrepar.
 */

/** Lo minimo del pedido que decide cuanto efectivo trae. */
export interface PedidoALiquidar {
  metodoPago: MetodoPago;
  estadoPago: EstadoPago;
  total: Decimal;
  /** Lo que el cliente ya pago con su saldo de cashback al confirmar. */
  pagadoConBilletera: Decimal;
}

/** Un renglon del camion, con lo que subio y lo que el cliente acepto. */
export interface CargaLiquidable {
  cantidadCargada: number;
  cantidadEntregada: number;
  precioUnitario: Decimal;
  /** Re-cotizado al volumen que acepto el cliente; `null` si manda el de arriba. */
  precioEntregado: Decimal | null;
}

/**
 * Si el dinero de este pedido pasa por las manos del repartidor.
 *
 * Solo el efectivo que todavia no se ha cobrado. Una transferencia no la trae
 * el, un pedido ya PAGADO se cobro antes de salir, y CREDITO es justamente
 * Finanzas autorizando entregar sin cobrar. Cubierto entero con la billetera
 * no queda nada que cobrar y cae por el mismo camino, porque nace PAGADO.
 */
export function traeEfectivo(pedido: PedidoALiquidar): boolean {
  if (pedido.metodoPago !== MetodoPago.EFECTIVO) return false;
  return (
    pedido.estadoPago === EstadoPago.PAGO_PENDIENTE || pedido.estadoPago === EstadoPago.LIBERAR
  );
}

/** Lo que se cobra por un renglon: el precio que toque por lo que acepto el cliente. */
export function cobradoDelRenglon(carga: CargaLiquidable): Decimal {
  const precio = carga.precioEntregado ?? carga.precioUnitario;
  return new Decimal(precio).mul(carga.cantidadEntregada);
}

/** Lo que el pedido cobraba por ese renglon antes de salir el camion. */
export function cotizadoDelRenglon(carga: CargaLiquidable): Decimal {
  return new Decimal(carga.precioUnitario).mul(carga.cantidadCargada);
}

/**
 * El efectivo que trae por un pedido.
 *
 * Se parte de lo que el pedido iba a cobrar (`total` menos lo que ya pago con
 * su billetera) y se descuenta lo que el cliente no acepto, a los precios que
 * correspondan: los del pedido para lo que se cotizo, el re-cotizado para lo
 * que si se llevo. Envio, recargo y descuento no se tocan —el viaje se hizo y
 * el cupon se uso— y el resultado nunca baja de cero: una devolucion grande no
 * convierte al repartidor en acreedor, eso lo arregla Finanzas con el pedido
 * delante.
 */
export function efectivoDelPedido(pedido: PedidoALiquidar, cargas: CargaLiquidable[]): Decimal {
  if (!traeEfectivo(pedido)) return new Decimal(0);

  const aPagar = new Decimal(pedido.total).sub(pedido.pagadoConBilletera);
  const noEntregado = cargas.reduce(
    (suma, carga) => suma.add(cotizadoDelRenglon(carga).sub(cobradoDelRenglon(carga))),
    new Decimal(0),
  );

  return Decimal.max(0, aPagar.sub(noEntregado));
}

/** Lo que la hoja de entrega le dice al repartidor antes de confirmar. */
export interface CuentaDeLaEntrega {
  /** Lo que vale lo que el cliente acepto, ya re-cotizado. */
  productos: Decimal;
  /** El efectivo que se cobra en la puerta: el mismo numero que pedira el corte. */
  aCobrar: Decimal;
  /** `null` mientras el pago recibido no cubra el cobro. */
  cambio: Decimal | null;
  /** Si con lo recibido ya se puede cerrar la entrega. */
  cubre: boolean;
}

/**
 * La cuenta de la entrega, con lo que el repartidor lleva contado.
 *
 * Sale de `efectivoDelPedido` y no de sumar aparte: si la hoja pidiera un
 * numero y el corte otro, el repartidor cobraria uno y le faltaria el otro.
 * Sin efectivo que cobrar (transferencia, pagado, credito) siempre cubre.
 */
export function cuentaDeLaEntrega(
  pedido: PedidoALiquidar,
  cargas: CargaLiquidable[],
  pagoRecibido: Decimal | null,
): CuentaDeLaEntrega {
  const productos = cargas.reduce(
    (suma, carga) => suma.add(cobradoDelRenglon(carga)),
    new Decimal(0),
  );
  const aCobrar = efectivoDelPedido(pedido, cargas);

  if (aCobrar.isZero()) return { productos, aCobrar, cambio: null, cubre: true };
  const cubre = pagoRecibido !== null && pagoRecibido.greaterThanOrEqualTo(aCobrar);
  return { productos, aCobrar, cambio: cubre ? pagoRecibido.sub(aCobrar) : null, cubre };
}

/** Lo que un renglon devuelve a bodega. */
export function devueltoDelRenglon(carga: CargaLiquidable): number {
  return Math.max(0, carga.cantidadCargada - carga.cantidadEntregada);
}
