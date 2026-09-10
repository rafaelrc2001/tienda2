/**
 * Formateo de dinero y fechas.
 *
 * Un solo sitio para que el símbolo, los decimales y el orden de la fecha no
 * bailen de pantalla en pantalla. La app es solo en español de México.
 */

const MONEDA = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const FECHA_CORTA = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const FECHA_HORA = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** `1234.5` → `$1,234.50`. */
export function dinero(monto: number): string {
  return MONEDA.format(Number.isFinite(monto) ? monto : 0)
}

/**
 * `1234.5` → `{ entero: '$1,234', centavos: '50' }`.
 *
 * La tarjeta de la Tienda pinta los centavos en volado sobre el precio, así que
 * necesita las dos mitades por separado. Se parten del texto que ya formateó
 * `dinero` y no del número: así el separador de miles y el símbolo salen de la
 * misma regla que en el resto de la aplicación.
 */
export function partesDinero(monto: number): { entero: string; centavos: string } {
  const texto = dinero(monto)
  const corte = texto.lastIndexOf('.')
  if (corte === -1) return { entero: texto, centavos: '00' }
  return { entero: texto.slice(0, corte), centavos: texto.slice(corte + 1) }
}

/** ISO → `07 sep 2026`. Cadena vacía si la fecha no vale. */
export function fecha(iso: string | null | undefined): string {
  if (!iso) return ''
  const valor = new Date(iso)
  return Number.isNaN(valor.getTime()) ? '' : FECHA_CORTA.format(valor)
}

/** ISO → `07 sep 2026, 14:30`. */
export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return ''
  const valor = new Date(iso)
  return Number.isNaN(valor.getTime()) ? '' : FECHA_HORA.format(valor)
}

/** Días que faltan para una fecha. Negativo si ya pasó. */
export function diasHasta(iso: string | null | undefined): number | null {
  if (!iso) return null
  const valor = new Date(iso)
  if (Number.isNaN(valor.getTime())) return null
  const MS_DIA = 24 * 60 * 60 * 1000
  return Math.ceil((valor.getTime() - Date.now()) / MS_DIA)
}
