/**
 * El inventario del camión de una entrega: por producto, lo que se subió, lo
 * que ya se quedó con los clientes y lo que sigue arriba.
 *
 * Son piezas, no dinero: la regla de que el navegador no suma totales es por
 * los importes. Aquí se cuentan las cantidades que la API ya trae en `carga`,
 * igual que la libreta de Operaciones cuenta los renglones del pedido.
 */
import type { RenglonDeCarga } from '@/api/tipos'

/** Un producto del inventario del camión. */
export interface ProductoEnCamion {
  productoId: string
  nombre: string
  unidad: string
  /** Lo que subió al camión («Recolectado»). */
  recolectado: number
  /** Lo que se quedó en casa del cliente. */
  entregado: number
  /** Recolectado menos entregado: lo que sigue arriba. */
  diferencia: number
}

/**
 * Solo el último intento de cada renglón del pedido.
 *
 * Un pedido que no se entregó y volvió a bodega trae también la carga de su
 * viaje anterior (ya cerrada por aquel corte). Esa mercancía ya bajó: contarla
 * aquí la duplicaría. La API manda la carga en orden de creación, así que el
 * último renglón de cada `pedidoItemId` es el de esta entrega.
 */
function ultimoIntento(carga: RenglonDeCarga[]): RenglonDeCarga[] {
  const porItem = new Map<string, RenglonDeCarga>()
  for (const renglon of carga) porItem.set(renglon.pedidoItemId, renglon)
  return [...porItem.values()]
}

/**
 * Junta la carga de todos los pedidos de la entrega por producto.
 *
 * Se agrupa por `productoId`, como la libreta: dos productos que se llaman
 * igual con distinta unidad no son el mismo. Orden alfabético. Tampoco hay
 * total general: sumar kilos con piezas daría un número que no significa nada.
 */
export function inventarioDelCamion(pedidos: { carga: RenglonDeCarga[] }[]): ProductoEnCamion[] {
  const porProducto = new Map<string, ProductoEnCamion>()

  for (const pedido of pedidos) {
    for (const renglon of ultimoIntento(pedido.carga)) {
      const actual = porProducto.get(renglon.productoId) ?? {
        productoId: renglon.productoId,
        nombre: renglon.nombre,
        unidad: renglon.unidad,
        recolectado: 0,
        entregado: 0,
        diferencia: 0,
      }
      actual.recolectado += renglon.cantidadCargada
      actual.entregado += renglon.cantidadEntregada
      actual.diferencia = actual.recolectado - actual.entregado
      porProducto.set(renglon.productoId, actual)
    }
  }

  return [...porProducto.values()].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }),
  )
}
