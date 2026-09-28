import { AfectaInventario, MotivoMovimiento, TipoMovimiento } from '@prisma/client';

/**
 * Cuanto mueve el inventario un pedido al entregarse y al volver del camion.
 *
 * Funciones puras, sin base de datos: `InventarioService` lee los movimientos
 * del pedido, pregunta aqui cuanto toca y aplica. Las dos cuentas se deducen
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

/**
 * Lo que sale del fisico al entregarse el pedido.
 *
 * Solo sale lo que se aparto con una VENTA de solo APT y no ha salido todavia
 * con una ENTREGA. Asi un pedido hecho con el control apagado —sin VENTA— no
 * descuenta nada, uno de antes de separar los dos momentos —que vendio con
 * AMBOS y ya bajo el fisico— tampoco lo baja dos veces, y entregar dos veces
 * el mismo pedido no saca de mas.
 *
 * Un producto que viene en varios renglones sale en un solo movimiento.
 */
export function salidasAlEntregar(
  movimientos: MovimientoDelPedido[],
  lineas: LineaAMover[],
): LineaAMover[] {
  const enBodega = new Map<string, number>();
  for (const m of movimientos) {
    const aparta = m.motivo === MotivoMovimiento.VENTA && m.afecta === AfectaInventario.APT;
    const sale = m.motivo === MotivoMovimiento.ENTREGA;
    if (!aparta && !sale) continue;
    enBodega.set(m.productoId, (enBodega.get(m.productoId) ?? 0) + (aparta ? 1 : -1) * m.cantidad);
  }

  const pedidas = new Map<string, number>();
  for (const l of lineas) {
    pedidas.set(l.productoId, (pedidas.get(l.productoId) ?? 0) + l.cantidad);
  }

  const salidas: LineaAMover[] = [];
  for (const [productoId, cantidad] of pedidas) {
    const sale = Math.min(cantidad, enBodega.get(productoId) ?? 0);
    if (sale > 0) salidas.push({ productoId, cantidad: sale });
  }
  return salidas;
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
 * alcance con el que se hizo la venta: con la venta en solo APT, el fisico no
 * se toca, porque lo rechazado nunca bajo de el.
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
