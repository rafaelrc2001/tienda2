/**
 * Los motivos de devolución, escritos como los dice un repartidor.
 *
 * Viven aquí y no dentro de cada ventana porque la entrega los ofrece para
 * capturar y la tarjeta del pedido los lee después: si divergieran, el mismo
 * motivo se llamaría de dos maneras en la misma pantalla.
 */
import type { EstadoPedido, MotivoDevolucion } from '@/api/tipos'

/**
 * El botón del único paso que cada estado tiene por delante en Rutas. Lo leen
 * la pantalla de Rutas y la de cada entrega: el mismo paso se llama igual.
 */
export const TITULO_PASO: Partial<Record<EstadoPedido, string>> = {
  RECOLECTADO: 'Recolectado',
  EN_RUTA: 'En ruta',
  ENTREGADO: 'Entregar',
}

/** «Entrega 2 · Centro», o solo el número si no tiene nombre. */
export function nombreEntrega(entrega: { numero: number; nombre: string | null }): string {
  return entrega.nombre
    ? `Entrega ${entrega.numero} · ${entrega.nombre}`
    : `Entrega ${entrega.numero}`
}

const NOMBRE_MOTIVO: Record<MotivoDevolucion, string> = {
  NO_LO_QUISO: 'No lo quiso',
  DANADO: 'Llegó dañado',
  SIN_QUIEN_RECIBA: 'No había quien recibiera',
  PRECIO_EQUIVOCADO: 'Precio equivocado',
}

/** El catálogo entero, en el orden en que se ofrece. */
export const MOTIVOS: { valor: MotivoDevolucion; etiqueta: string }[] = (
  Object.keys(NOMBRE_MOTIVO) as MotivoDevolucion[]
).map((valor) => ({ valor, etiqueta: NOMBRE_MOTIVO[valor] }))

export function nombreMotivo(motivo: MotivoDevolucion): string {
  return NOMBRE_MOTIVO[motivo] ?? motivo
}
