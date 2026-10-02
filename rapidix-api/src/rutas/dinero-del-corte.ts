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
  return pedido.estadoPago === EstadoPago.PAGO_PENDIENTE;
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
 * El efectivo que trae por un pedido: lo que cobra (`total` menos lo que ya
 * pago con su billetera), si ese dinero pasa por sus manos.
 *
 * No descuenta nada de lo no aceptado porque ya viene descontado: la entrega
 * deja el pedido como se entrego (`ajusteDeEntrega`). Restarlo aqui otra vez
 * lo cobraria de menos.
 */
export function efectivoDelPedido(pedido: PedidoALiquidar): Decimal {
  if (!traeEfectivo(pedido)) return new Decimal(0);
  return Decimal.max(0, new Decimal(pedido.total).sub(pedido.pagadoConBilletera));
}

/** Que le pasa al dinero de un pedido cuando Finanzas acepta su entrega. */
export enum DestinoDelPedido {
  /** Su efectivo ya esta aceptado: queda pagado y gana su cashback. */
  PAGADO = 'PAGADO',
  /** Se entrego a credito y debe: es una cuenta por cobrar. */
  CXC = 'CXC',
}

/**
 * Lo que "Entrega aceptada" hace con cada pedido entregado del corte, o
 * `null` si no le toca nada.
 *
 *  - El que **trae efectivo** queda pagado. El cliente ya pago en la puerta;
 *    que el repartidor aun deba parte de ese dinero es un adeudo suyo, no del
 *    cliente, y no tiene por que frenar su cashback.
 *  - El que se entrego **a credito** y debe algo pasa a cuenta por cobrar. Uno
 *    cubierto entero con la billetera no debe nada y no entra.
 *  - Lo demas —ya pagado en linea, reembolsado, cancelado— se queda como esta.
 */
export function destinoAlAceptar(pedido: PedidoALiquidar): DestinoDelPedido | null {
  if (traeEfectivo(pedido)) return DestinoDelPedido.PAGADO;
  if (pedido.estadoPago !== EstadoPago.CREDITO) return null;
  const debe = new Decimal(pedido.total).sub(pedido.pagadoConBilletera);
  return debe.gt(0) ? DestinoDelPedido.CXC : null;
}

/** Como queda el dinero del pedido tras una entrega. */
export interface AjusteDeEntrega {
  /** Lo que valia lo que el cliente no acepto, a los precios que correspondan. */
  noEntregado: Decimal;
  total: Decimal;
  /** Lo que queda pagado con billetera: nunca mas que el total nuevo. */
  pagadoConBilletera: Decimal;
  /** El saldo de billetera que ya no hace falta y vuelve al cliente. */
  billeteraDevuelta: Decimal;
}

/**
 * El pedido pasa a valer lo que el cliente se quedo.
 *
 * Se descuenta lo que no acepto a los precios que correspondan: los del pedido
 * para lo que se cotizo, el re-cotizado para lo que si se llevo (quien pide 10
 * al precio de 10 y acepta 6 no compro 10). Envio, recargo y descuento no se
 * tocan —el viaje se hizo y el cupon se uso— y el total nunca baja de cero.
 * Si baja de lo que ya pago con su billetera, el sobrante le vuelve: el
 * repartidor no cobra nada y el cliente no pierde saldo por algo que no se llevo.
 */
export function ajusteDeEntrega(
  pedido: Pick<PedidoALiquidar, 'total' | 'pagadoConBilletera'>,
  cargas: CargaLiquidable[],
): AjusteDeEntrega {
  const noEntregado = cargas.reduce(
    (suma, carga) => suma.add(cotizadoDelRenglon(carga).sub(cobradoDelRenglon(carga))),
    new Decimal(0),
  );
  const total = Decimal.max(0, new Decimal(pedido.total).sub(noEntregado));
  const pagadoConBilletera = Decimal.min(pedido.pagadoConBilletera, total);
  return {
    noEntregado,
    total,
    pagadoConBilletera,
    billeteraDevuelta: new Decimal(pedido.pagadoConBilletera).sub(pagadoConBilletera),
  };
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
 * Es `efectivoDelPedido` sobre el pedido ya ajustado, que es justo lo que
 * leera el corte: si la hoja pidiera un numero y el corte otro, el repartidor
 * cobraria uno y le faltaria el otro. Sin efectivo que cobrar (transferencia,
 * pagado, credito) siempre cubre.
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
  const aCobrar = efectivoDelPedido({ ...pedido, ...ajusteDeEntrega(pedido, cargas) });

  if (aCobrar.isZero()) return { productos, aCobrar, cambio: null, cubre: true };
  const cubre = pagoRecibido !== null && pagoRecibido.greaterThanOrEqualTo(aCobrar);
  return { productos, aCobrar, cambio: cubre ? pagoRecibido.sub(aCobrar) : null, cubre };
}

/** Lo que un renglon devuelve a bodega. */
export function devueltoDelRenglon(carga: CargaLiquidable): number {
  return Math.max(0, carga.cantidadCargada - carga.cantidadEntregada);
}
