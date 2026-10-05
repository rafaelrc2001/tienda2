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

/**
 * «Entrega REP000025»: el folio es lo único que la identifica. El número dentro
 * de la jornada se repetía entre repartidores y no cuadraba con el folio, así
 * que ya no se enseña.
 */
export function nombreEntrega(entrega: { folio: string }): string {
  return `Entrega ${entrega.folio}`
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
