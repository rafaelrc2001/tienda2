/**
 * Orden de la tabla de Configuración → Fiscal → Facturación, como el de
 * Finanzas → Bancos: tocar un encabezado ordena ascendente, luego descendente
 * y luego vuelve al orden en que llegan (la más reciente primero).
 */
import type { FacturaEmitida } from '@/api/tipos'
import type { Direccion } from '../finanzas/bancos'

export type ColumnaFacturas =
  'fecha' | 'serieFolio' | 'rfc' | 'nombre' | 'formaPago' | 'total' | 'creada' | 'creo'

export interface OrdenFacturas {
  columna: ColumnaFacturas
  direccion: Direccion
}

/** Lo que se compara de cada columna. Vacío es `null`. */
function valor(f: FacturaEmitida, columna: ColumnaFacturas): string | number | null {
  switch (columna) {
    case 'fecha':
      return f.timbradaEn
    case 'serieFolio':
      return f.serieFolio
    case 'rfc':
      return f.rfc
    case 'nombre':
      return f.nombre.trim() || null
    case 'formaPago':
      return f.formaPago.clave
    case 'total':
      return f.total
    case 'creada':
      return f.creadaEn
    case 'creo':
      return f.creadoPor?.nombre.trim() || null
  }
}

/** `numeric`: «F-10» va después de «F-9», no entre «F-1» y «F-2». */
const comparador = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })

/**
 * Las facturas en el orden pedido, sin tocar el arreglo original. Las celdas
 * vacías van siempre al final y los empates conservan el orden de llegada.
 */
export function ordenarFacturas(
  facturas: readonly FacturaEmitida[],
  orden: OrdenFacturas | null,
): FacturaEmitida[] {
  if (!orden) return [...facturas]
  const signo = orden.direccion === 'asc' ? 1 : -1
  return facturas
    .map((f, i) => ({ f, i, v: valor(f, orden.columna) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) {
        if (a.v === b.v) return a.i - b.i
        return a.v === null ? 1 : -1
      }
      const diferencia =
        typeof a.v === 'number' && typeof b.v === 'number'
          ? a.v - b.v
          : comparador.compare(String(a.v), String(b.v))
      return diferencia * signo || a.i - b.i
    })
    .map(({ f }) => f)
}

/** Ascendente, descendente y de vuelta al orden de llegada. */
export function siguienteOrdenFacturas(
  actual: OrdenFacturas | null,
  columna: ColumnaFacturas,
): OrdenFacturas | null {
  if (actual?.columna !== columna) return { columna, direccion: 'asc' }
  return actual.direccion === 'asc' ? { columna, direccion: 'desc' } : null
}
