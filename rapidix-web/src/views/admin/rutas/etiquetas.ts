/**
 * Los motivos de devolución, escritos como los dice un repartidor.
 *
 * Viven aquí y no dentro de cada ventana porque la entrega los ofrece para
 * capturar y la tarjeta del pedido los lee después: si divergieran, el mismo
 * motivo se llamaría de dos maneras en la misma pantalla.
 */
import type { MotivoDevolucion } from '@/api/tipos'

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
