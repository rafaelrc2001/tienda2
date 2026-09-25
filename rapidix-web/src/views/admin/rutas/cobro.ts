/**
 * Si el dinero de un pedido pasa por las manos del repartidor.
 *
 * Vive aparte porque lo leen la tabla de Rutas y la hoja de entrega: si
 * divergieran, la tabla diría «Cobrar» y la hoja «no cobras» del mismo pedido.
 */
import type { Pedido } from '@/api/tipos'

/** Lo demás ya se cobró o no se cobra en la puerta. */
export function cobraEnEfectivo(pedido: Pedido): boolean {
  return (
    pedido.pago.metodo === 'EFECTIVO' &&
    pedido.pago.aPagar > 0 &&
    (pedido.pago.estado === 'PAGO_PENDIENTE' || pedido.pago.estado === 'LIBERAR')
  )
}
