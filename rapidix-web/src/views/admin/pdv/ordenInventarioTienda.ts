/**
 * Orden de la tabla de PDV → Inventario, como el de Finanzas → Bancos y
 * Fiscal → Facturación: tocar un encabezado ordena ascendente, luego
 * descendente y luego vuelve al orden en que llega del backend.
 */
import type { ExistenciaTienda } from '@/api/tipos'
import type { Direccion } from '../finanzas/bancos'

export type ColumnaInventarioTienda = 'producto' | 'fisico' | 'comprometido' | 'disponible'

export interface OrdenInventarioTienda {
  columna: ColumnaInventarioTienda
  direccion: Direccion
}

/** Lo que se compara de cada columna. */
function valor(e: ExistenciaTienda, columna: ColumnaInventarioTienda): string | number {
  switch (columna) {
    case 'producto':
      return e.nombre.trim()
    case 'fisico':
      return e.cantidad
    case 'comprometido':
      return e.comprometido
    case 'disponible':
      return e.disponible
  }
}

/** `numeric`: «Botella 10» va después de «Botella 9», no entre «1» y «2». */
const comparador = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })

/** Las existencias en el orden pedido, sin tocar el arreglo original; los empates conservan el de llegada. */
export function ordenarInventarioTienda(
  existencias: readonly ExistenciaTienda[],
  orden: OrdenInventarioTienda | null,
): ExistenciaTienda[] {
  if (!orden) return [...existencias]
  const signo = orden.direccion === 'asc' ? 1 : -1
  return existencias
    .map((e, i) => ({ e, i, v: valor(e, orden.columna) }))
    .sort((a, b) => {
      const diferencia =
        typeof a.v === 'number' && typeof b.v === 'number'
          ? a.v - b.v
          : comparador.compare(String(a.v), String(b.v))
      return diferencia * signo || a.i - b.i
    })
    .map(({ e }) => e)
}

/** Ascendente, descendente y de vuelta al orden de llegada. */
export function siguienteOrdenInventarioTienda(
  actual: OrdenInventarioTienda | null,
  columna: ColumnaInventarioTienda,
): OrdenInventarioTienda | null {
  if (actual?.columna !== columna) return { columna, direccion: 'asc' }
  return actual.direccion === 'asc' ? { columna, direccion: 'desc' } : null
}
