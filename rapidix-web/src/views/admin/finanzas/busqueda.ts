/**
 * La búsqueda de Finanzas → Pedidos.
 *
 * Funciones puras. Se busca sobre lo que la tabla enseña —folio, cliente,
 * estado del pedido y estatus de pago, con sus nombres en pantalla— y no sobre
 * los códigos: quien escribe «pendiente» espera los «Pago pendiente».
 */
import { nombreEstadoPago, nombreEstadoPedido } from '@/utils/formato'
import type { PedidoEnFinanzas } from '@/api/tipos'

/** Sin acentos ni mayúsculas: «credito» encuentra «Crédito». */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Todo lo que se puede buscar de un pedido, en una sola línea. */
function textoDe(pedido: PedidoEnFinanzas): string {
  return normalizar(
    [
      pedido.folio,
      pedido.clienteNombre ?? '',
      nombreEstadoPedido(pedido.estado),
      nombreEstadoPago(pedido.pago.estado),
    ].join(' '),
  )
}

/**
 * Los pedidos que coinciden con lo escrito. Cada palabra tiene que aparecer,
 * en cualquier orden: «prueba pagado» son los pagados de «Cliente de prueba».
 * Vacío devuelve todos.
 */
export function buscarPedidos(pedidos: PedidoEnFinanzas[], consulta: string): PedidoEnFinanzas[] {
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return pedidos
  return pedidos.filter((pedido) => {
    const texto = textoDe(pedido)
    return palabras.every((palabra) => texto.includes(palabra))
  })
}
