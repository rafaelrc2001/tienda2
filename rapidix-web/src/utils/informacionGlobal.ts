/**
 * Factura de un pedido a PÚBLICO EN GENERAL: el SAT la trata como global
 * (CFDI40130) y pide el periodo que cubre —periodicidad, mes y año—. Aquí solo
 * se decide cuándo enseñar esos campos y con qué llegan; los catálogos y las
 * reglas finas (bimestral solo RIF, año válido) los pone la API.
 */

export const RFC_GENERICO = 'XAXX010101000'
export const PUBLICO_EN_GENERAL = 'PUBLICO EN GENERAL'

const normalizado = (texto: string): string => texto.trim().replace(/\s+/g, ' ').toUpperCase()

export function esRfcGenerico(rfc: string): boolean {
  return normalizado(rfc) === RFC_GENERICO
}

/**
 * Con el RFC genérico y el nombre PUBLICO EN GENERAL es global. Con el RFC
 * genérico y el nombre de la persona es nominativa y no lleva el periodo.
 */
export function esPublicoEnGeneral(rfc: string, razonSocial: string): boolean {
  return esRfcGenerico(rfc) && normalizado(razonSocial) === PUBLICO_EN_GENERAL
}

export const PERIODICIDAD_BIMESTRAL = '05'

/** Del 01 al 12 un mes; del 13 al 18 los bimestres, solo con periodicidad bimestral. */
export function mesesValidos<T extends { clave: string }>(meses: T[], periodicidad: string): T[] {
  const bimestral = periodicidad === PERIODICIDAD_BIMESTRAL
  return meses.filter((m) => Number(m.clave) > 12 === bimestral)
}

export interface PeriodoGlobal {
  periodicidad: string
  meses: string
  anio: number
}

/** Con lo que llega: diario, con el mes y el año de la venta en hora de México. */
export function periodoDeLaVenta(fecha: string | Date): PeriodoGlobal {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(fecha))
  const valor = (tipo: string): string => partes.find((p) => p.type === tipo)?.value ?? ''
  return { periodicidad: '01', meses: valor('month'), anio: Number(valor('year')) }
}

/** El año en curso y el anterior: los únicos que acepta el SAT. */
export function aniosValidos(hoy: Date = new Date()): number[] {
  const { anio } = periodoDeLaVenta(hoy)
  return [anio, anio - 1]
}
