import { AfectaInventario, MotivoMovimiento, TipoMovimiento } from '@prisma/client';

/**
 * Cuanto mueve el inventario un pedido al subir al camion, al entregarse y al
 * volver.
 *
 * Funciones puras, sin base de datos: `InventarioService` lee los movimientos
 * del pedido, pregunta aqui cuanto toca y aplica. Todas las cuentas se deducen
 * de **lo que de verdad paso** —los movimientos ya escritos— y no de las
 * lineas del pedido, para que nada salga ni entre dos veces.
 */

/** Un movimiento ya escrito del pedido: lo unico que las cuentas necesitan. */
export interface MovimientoDelPedido {
  productoId: string;
  cantidad: number;
  tipo: TipoMovimiento;
  afecta: AfectaInventario;
  motivo: MotivoMovimiento;
}

/** Lo que se pide mover de un producto, contado por quien entrega o descarga. */
export interface LineaAMover {
  productoId: string;
  cantidad: number;
}

/** Las piezas pedidas de cada producto, juntando sus renglones. */
function porProducto(lineas: LineaAMover[]): Map<string, number> {
  const pedidas = new Map<string, number>();
  for (const l of lineas) {
    pedidas.set(l.productoId, (pedidas.get(l.productoId) ?? 0) + l.cantidad);
  }
  return pedidas;
}

/**
 * Lo que el pedido tiene apartado y sigue en el estante, por producto.
 *
 * Entra lo que se aparto con una VENTA de solo APT; sale lo que ya se fue con
 * una ENTREGA (en tienda) o subio a un camion con RUTA, y vuelve a entrar lo
 * que bajo del camion. Una venta con AMBOS —las de antes de separar los dos
 * momentos— no cuenta: ya bajo el fisico.
 */
function apartadoEnBodega(movimientos: MovimientoDelPedido[]): Map<string, number> {
  const enBodega = new Map<string, number>();
  for (const m of movimientos) {
    let piezas: number;
    if (m.motivo === MotivoMovimiento.VENTA && m.afecta === AfectaInventario.APT) {
      piezas = m.cantidad;
    } else if (m.motivo === MotivoMovimiento.ENTREGA) {
      piezas = -m.cantidad;
    } else if (m.motivo === MotivoMovimiento.RUTA) {
      piezas = m.tipo === TipoMovimiento.SALIDA ? -m.cantidad : m.cantidad;
    } else continue;
    enBodega.set(m.productoId, (enBodega.get(m.productoId) ?? 0) + piezas);
  }
  return enBodega;
}

/** De lo pedido, lo que todavia puede salir del estante. Un movimiento por producto. */
function loQueSale(movimientos: MovimientoDelPedido[], lineas: LineaAMover[]): LineaAMover[] {
  const enBodega = apartadoEnBodega(movimientos);
  const salidas: LineaAMover[] = [];
  for (const [productoId, cantidad] of porProducto(lineas)) {
    const sale = Math.min(cantidad, enBodega.get(productoId) ?? 0);
    if (sale > 0) salidas.push({ productoId, cantidad: sale });
  }
  return salidas;
}

/**
 * Lo que sale del fisico al entregarse el pedido.
 *
 * Solo sale lo que se aparto con una VENTA de solo APT y no ha salido todavia,
 * ni con una ENTREGA ni a un camion con RUTA. Asi un pedido recolectado —que
 * ya saco su fisico al subir— no lo baja otra vez en la puerta del cliente,
 * uno hecho con el control apagado —sin VENTA— no descuenta nada, uno de antes
 * de separar los dos momentos —que vendio con AMBOS y ya bajo el fisico—
 * tampoco lo baja dos veces, y entregar dos veces el mismo pedido no saca de
 * mas.
 *
 * En la practica solo saca algo la entrega en tienda, y el pedido que se
 * recolecto antes de que existiera RUTA.
 *
 * Un producto que viene en varios renglones sale en un solo movimiento.
 */
export function salidasAlEntregar(
  movimientos: MovimientoDelPedido[],
  lineas: LineaAMover[],
): LineaAMover[] {
  return loQueSale(movimientos, lineas);
}

/**
 * Lo que sale del fisico al recolectarse el pedido: sube al camion.
 *
 * Es la misma cuenta que al entregar, y a proposito: en los dos momentos sale
 * lo apartado que sigue en el estante, y lo que distingue uno de otro es el
 * motivo con que se escribe. Recolectar dos veces no saca de mas, y un pedido
 * que regreso de ruta puede volver a salir otro dia porque su regreso lo
 * devolvio a la cuenta.
 */
export function salidasARuta(
  movimientos: MovimientoDelPedido[],
  lineas: LineaAMover[],
): LineaAMover[] {
  return loQueSale(movimientos, lineas);
}

/**
 * Lo que vuelve al fisico al bajar del camion: el pedido que se quita de la
 * entrega antes de salir y lo que el corte descarga.
 *
 * Nunca entra mas de lo que subio: el tope es lo que el pedido tiene fuera por
 * RUTA, salidas menos entradas. Por eso un pedido recolectado con el control
 * apagado, o antes de que existiera RUTA, no devuelve nada —su fisico nunca
 * bajo al subir— y descargar dos veces el mismo renglon no infla el saldo.
 *
 * Un producto que viene en varios renglones vuelve en un solo movimiento.
 */
export function regresosDeRuta(
  movimientos: MovimientoDelPedido[],
  lineas: LineaAMover[],
): LineaAMover[] {
  const enRuta = new Map<string, number>();
  for (const m of movimientos) {
    if (m.motivo !== MotivoMovimiento.RUTA) continue;
    const signo = m.tipo === TipoMovimiento.SALIDA ? 1 : -1;
    enRuta.set(m.productoId, (enRuta.get(m.productoId) ?? 0) + signo * m.cantidad);
  }

  const regresos: LineaAMover[] = [];
  for (const [productoId, cantidad] of porProducto(lineas)) {
    const vuelve = Math.min(cantidad, enRuta.get(productoId) ?? 0);
    if (vuelve > 0) regresos.push({ productoId, cantidad: vuelve });
  }
  return regresos;
}

/** Lo que vuelve a estar disponible, con el alcance con el que se vendio. */
export interface Devolucion extends LineaAMover {
  afecta: AfectaInventario;
}

/**
 * Lo que vuelve a bodega de lo que el cliente rechazo, al cerrar el corte.
 *
 * Nunca entra mas de lo que salio: el tope es lo vendido menos lo ya devuelto.
 * Por eso un pedido sin VENTA (control apagado) no devuelve nada y devolver
 * dos veces el mismo renglon no infla el saldo. Se deshace con el mismo
 * alcance con el que se hizo la venta: con la venta en solo APT, esta cuenta
 * no toca el fisico. Lo que salio de el al recolectar vuelve por su lado, con
 * `regresosDeRuta()`.
 */
export function devolucionesDeRuta(
  movimientos: MovimientoDelPedido[],
  lineas: LineaAMover[],
): Devolucion[] {
  const fuera = new Map<string, { piezas: number; afecta: AfectaInventario }>();
  for (const m of movimientos) {
    if (m.motivo !== MotivoMovimiento.VENTA && m.motivo !== MotivoMovimiento.DEVOLUCION) continue;
    const signo = m.tipo === TipoMovimiento.SALIDA ? 1 : -1;
    const actual = fuera.get(m.productoId);
    fuera.set(m.productoId, {
      piezas: (actual?.piezas ?? 0) + signo * m.cantidad,
      afecta: actual?.afecta ?? m.afecta,
    });
  }

  const devoluciones: Devolucion[] = [];
  for (const linea of lineas) {
    const pendiente = fuera.get(linea.productoId);
    if (!pendiente) continue;
    const cantidad = Math.min(linea.cantidad, pendiente.piezas);
    if (cantidad <= 0) continue;

    devoluciones.push({ productoId: linea.productoId, cantidad, afecta: pendiente.afecta });
    pendiente.piezas -= cantidad;
  }
  return devoluciones;
}
