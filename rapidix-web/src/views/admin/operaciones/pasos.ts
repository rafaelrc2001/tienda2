import type { EstadoPedido, PedidoEnPantalla } from '@/api/tipos'

/**
 * La fila de botones con la que se surte un pedido. La comparten
 * Administración → Operaciones (lo que surte bodega) y la pestaña Operaciones
 * del PDV (lo que se recoge en una tienda): son los mismos pasos.
 *
 * Aquí no hay ninguna regla: qué paso toca y por qué está bloqueado lo dice
 * la API en `pedido.paso`. Esto solo lo traduce a qué botón se enciende.
 */

/**
 * Los estados del pedido, en orden, pintados como una fila de botones: cada
 * uno se enciende cuando se dio el anterior. «Entregado» solo lo da aquí un
 * pedido de tienda; el de domicilio lo sigue Rutas y se ve apagado.
 */
export const PASOS: EstadoPedido[] = [
  'EN_PREPARACION',
  'PREPARADO',
  'LISTO_PARA_ENTREGA',
  'ENTREGADO',
]

const ORDEN_ESTADO: EstadoPedido[] = [
  'CONFIRMADO',
  'EN_PREPARACION',
  'PREPARADO',
  'LISTO_PARA_ENTREGA',
  'RECOLECTADO',
  'EN_RUTA',
  'ENTREGADO',
]

/** El pedido ya pasó por ese estado: el botón queda marcado como hecho. */
export function pasoDado(pedido: PedidoEnPantalla, estado: EstadoPedido): boolean {
  return ORDEN_ESTADO.indexOf(pedido.estado) >= ORDEN_ESTADO.indexOf(estado)
}

/** Solo se enciende el paso que la API dice que toca a Operaciones. */
export function esPasoSiguiente(pedido: PedidoEnPantalla, estado: EstadoPedido): boolean {
  return (
    pedido.pago.estado !== 'CANCELADO' &&
    pedido.paso.seccion === 'operaciones' &&
    pedido.paso.siguiente === estado
  )
}

/** El bloqueo del paso que toca, para enseñarlo bajo los botones. */
export function bloqueoDe(pedido: PedidoEnPantalla): string | null {
  const siguiente = pedido.paso.siguiente
  if (!siguiente || !esPasoSiguiente(pedido, siguiente)) return null
  return pedido.paso.bloqueo?.mensaje ?? null
}
