/**
 * La búsqueda de Finanzas → Pedidos.
 *
 * Se busca sobre lo que la tabla enseña: folio, canal, cliente, estado del
 * pedido y estatus de pago, con sus nombres en pantalla.
 */
import { filtrarPorTexto } from '@/utils/busqueda'
import { nombreEstadoPago, nombreEstadoPedido } from '@/utils/formato'
import type { PedidoEnFinanzas } from '@/api/tipos'

export { normalizar } from '@/utils/busqueda'

export function buscarPedidos(pedidos: PedidoEnFinanzas[], consulta: string): PedidoEnFinanzas[] {
  return filtrarPorTexto(pedidos, consulta, (pedido) => [
    pedido.folio,
    pedido.canal,
    pedido.clienteNombre,
    nombreEstadoPedido(pedido.estado),
    nombreEstadoPago(pedido.pago.estado),
  ])
}
