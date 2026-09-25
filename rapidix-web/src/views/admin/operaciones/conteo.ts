/**
 * El conteo de la libreta de Operaciones: cuántas piezas de cada producto
 * suman los pedidos que se palomearon, para surtirlos de una sola vuelta.
 *
 * Son piezas, no dinero: la regla de que el navegador no suma totales es por
 * los importes, que dependen de precios y promociones que solo sabe la API.
 * Aquí se cuentan las cantidades que el pedido ya trae, sin nada que cotizar.
 */
import type { ItemPedido } from '@/api/tipos'

/** Un producto de la lista consolidada. */
export interface ProductoContado {
  productoId: string
  nombre: string
  unidad: string
  cantidad: number
  /** En cuántos de los pedidos seleccionados aparece. */
  pedidos: number
}

/**
 * Junta los renglones de todos los pedidos por producto y suma sus cantidades.
 *
 * Se agrupa por `productoId` y no por nombre: dos productos pueden llamarse
 * igual con distinta unidad (azúcar por kilo y por bulto) y no se surten
 * juntos. El orden es alfabético, que es como se busca en una lista impresa.
 */
export function sumarProductos(pedidos: { items: ItemPedido[] }[]): ProductoContado[] {
  const porProducto = new Map<string, ProductoContado>()

  for (const pedido of pedidos) {
    // Un producto repetido dentro del mismo pedido cuenta como un solo pedido.
    const vistos = new Set<string>()
    for (const item of pedido.items) {
      const actual = porProducto.get(item.productoId)
      if (actual) {
        actual.cantidad += item.cantidad
        if (!vistos.has(item.productoId)) actual.pedidos += 1
      } else {
        porProducto.set(item.productoId, {
          productoId: item.productoId,
          nombre: item.nombre,
          unidad: item.unidad,
          cantidad: item.cantidad,
          pedidos: 1,
        })
      }
      vistos.add(item.productoId)
    }
  }

  return [...porProducto.values()].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }),
  )
}
