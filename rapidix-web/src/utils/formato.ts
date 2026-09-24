/**
 * Formateo de dinero y fechas.
 *
 * Un solo sitio para que el símbolo, los decimales y el orden de la fecha no
 * bailen de pantalla en pantalla. La app es solo en español de México.
 */

import type { EstadoPago, EstadoPedido } from '@/api/tipos'

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

const FECHA_NUMERICA = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/**
 * ISO → `21/09/26 14:30`. Para columnas de tabla, donde la fecha larga no cabe.
 * Se arma con las partes y no con el texto de `format` para que ningún
 * navegador cuele comas o «p.m.» entre la fecha y la hora.
 */
export function fechaNumerica(iso: string | null | undefined): string {
  if (!iso) return ''
  const valor = new Date(iso)
  if (Number.isNaN(valor.getTime())) return ''
  const partes: Record<string, string> = {}
  for (const parte of FECHA_NUMERICA.formatToParts(valor)) partes[parte.type] = parte.value
  return `${partes.day}/${partes.month}/${partes.year} ${partes.hour}:${partes.minute}`
}

/** `TRANSFERENCIA` → `Transferencia`. Lo que llega del enum de la API, legible. */
export function nombreMetodoPago(metodo: string): string {
  return metodo === 'TRANSFERENCIA' ? 'Transferencia' : 'Efectivo'
}

const NOMBRES_ESTADO_PAGO: Record<EstadoPago, string> = {
  PAGO_PENDIENTE: 'Pago pendiente',
  LIBERAR: 'Liberado',
  RETENER: 'Retenido',
  CREDITO: 'Crédito',
  REEMBOLSADO: 'Reembolsado',
  PAGADO: 'Pagado',
  CANCELADO: 'Cancelado',
}

/** `PAGO_PENDIENTE` → `Pago pendiente`. */
export function nombreEstadoPago(estado: EstadoPago): string {
  return NOMBRES_ESTADO_PAGO[estado] ?? estado
}

const NOMBRES_ESTADO_PEDIDO: Record<EstadoPedido, string> = {
  CONFIRMADO: 'Confirmado',
  EN_PREPARACION: 'En preparación',
  PREPARADO: 'Preparado',
  LISTO_PARA_ENTREGA: 'Listo para entrega',
  RECOLECTADO: 'Recolectado',
  EN_RUTA: 'En ruta',
  ENTREGADO: 'Entregado',
}

/**
 * Lo que se le enseña a quien mira el pedido. Un cancelado dice «Cancelado»
 * aunque la caja se haya quedado en otro paso: cancelar vive en el eje de pago.
 */
export function nombreEstadoPedido(estado: EstadoPedido, estadoPago?: EstadoPago): string {
  if (estadoPago === 'CANCELADO') return 'Cancelado'
  return NOMBRES_ESTADO_PEDIDO[estado] ?? estado
}

/** Días que faltan para una fecha. Negativo si ya pasó. */
export function diasHasta(iso: string | null | undefined): number | null {
  if (!iso) return null
  const valor = new Date(iso)
  if (Number.isNaN(valor.getTime())) return null
  const MS_DIA = 24 * 60 * 60 * 1000
  return Math.ceil((valor.getTime() - Date.now()) / MS_DIA)
}
