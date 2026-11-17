import type { MovimientoBancario } from '@/api/tipos'
import { nombreMetodoPago } from '@/utils/formato'

/**
 * Cómo lee Bancos las cantidades que se escriben o se copian del estado de
 * cuenta del banco.
 *
 * No usa `montoCapturado` de Rutas: ese cambia la primera coma por un punto,
 * y «6,750» copiado del banco se guardaría como 6.75 sin que nadie lo note.
 * Aquí la coma seguida de tres dígitos es de miles; seguida de uno o dos, es
 * la coma decimal. Lo que no encaja en ninguna forma se rechaza en vez de
 * adivinarlo.
 */

/** `1234`, `1234.5`, `1234.50`. */
const SIN_MILES = /^\d+(\.\d{1,2})?$/
/** `1,234`, `1,234,567.89`: comas cada tres dígitos. */
const CON_MILES = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/
/** `12,5`, `12,50`: la coma como punto decimal. */
const COMA_DECIMAL = /^\d+,\d{1,2}$/

/**
 * La cantidad como número, o `null` si el campo está vacío o no es un monto.
 * Acepta signo y `$` en cualquier orden (`-$6,750.00`, `$-6750`) y espacios.
 */
export function cantidadBancaria(texto: string): number | null {
  const limpio = texto.replace(/\s+/g, '')
  const partes = /^(-?)\$?(-?)(.*)$/.exec(limpio)
  if (!partes) return null
  const [, menosAntes, menosDespues, cuerpo] = partes
  if (menosAntes && menosDespues) return null

  let numero: number
  if (SIN_MILES.test(cuerpo)) numero = Number(cuerpo)
  else if (CON_MILES.test(cuerpo)) numero = Number(cuerpo.replace(/,/g, ''))
  else if (COMA_DECIMAL.test(cuerpo)) numero = Number(cuerpo.replace(',', '.'))
  else return null

  // `-0` se queda en cero: el signo de un cero no dice nada.
  if (numero === 0) return 0
  return menosAntes || menosDespues ? -numero : numero
}

/** `6`, `12`: piezas enteras, sin decimales. */
const CANTIDAD_PRODUCTO = /^\d+$/

/**
 * La cantidad de un producto de la factura global, o `null` si no sirve:
 * vacía, con letras, negativa, en cero o con decimales.
 */
export function cantidadDeProducto(texto: string): number | null {
  const limpio = texto.trim()
  if (!CANTIDAD_PRODUCTO.test(limpio)) return null
  const numero = Number(limpio)
  return numero > 0 ? numero : null
}

/**
 * El error de un campo de cantidad, o `null` si se puede mandar. `queEs` es
 * cómo se llama el campo en la frase («la cantidad», «el saldo inicial»).
 */
export function errorDeCantidad(texto: string, queEs: string): string | null {
  if (texto.trim() === '') return `Escribe ${queEs}.`
  if (cantidadBancaria(texto) === null) {
    return `No entiendo «${texto.trim()}» como cantidad: escríbela como 6750.00 o 6,750.00.`
  }
  return null
}

// ------------------------------------------------------------------
// Orden de la tabla, como el filtro de una columna de Excel
// ------------------------------------------------------------------

export type ColumnaBancos = 'fecha' | 'factura' | 'cantidad' | 'metodo' | 'referencia'
export type Direccion = 'asc' | 'desc'
export interface OrdenBancos {
  columna: ColumnaBancos
  direccion: Direccion
}

/** Lo que se compara de cada columna. Vacío es `null`. */
function valor(m: MovimientoBancario, columna: ColumnaBancos): string | number | null {
  switch (columna) {
    case 'fecha':
      return m.fecha
    case 'cantidad':
      return m.cantidad
    case 'metodo':
      return nombreMetodoPago(m.metodo)
    case 'factura':
      return m.factura?.trim() || null
    case 'referencia':
      return m.referencia?.trim() || null
  }
}

/** `numeric`: «F10» va después de «F9», no entre «F1» y «F2». */
const comparador = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })

/**
 * Los movimientos en el orden pedido, sin tocar el arreglo original. Solo
 * cambia cómo se ven: el saldo lo sigue sumando la API.
 *
 * Como en Excel, las celdas vacías van siempre al final, sea ascendente o
 * descendente. Los empates conservan el orden en que llegaron (el de captura).
 */
export function ordenarMovimientos(
  movimientos: readonly MovimientoBancario[],
  orden: OrdenBancos | null,
): MovimientoBancario[] {
  if (!orden) return [...movimientos]
  const signo = orden.direccion === 'asc' ? 1 : -1
  return movimientos
    .map((m, i) => ({ m, i, v: valor(m, orden.columna) }))
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
    .map(({ m }) => m)
}

/**
 * El siguiente orden al tocar el encabezado de una columna: ascendente,
 * descendente y luego vuelta al orden de captura.
 */
export function siguienteOrden(
  actual: OrdenBancos | null,
  columna: ColumnaBancos,
): OrdenBancos | null {
  if (actual?.columna !== columna) return { columna, direccion: 'asc' }
  return actual.direccion === 'asc' ? { columna, direccion: 'desc' } : null
}
