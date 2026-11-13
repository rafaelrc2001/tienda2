import { describe, expect, it } from 'vitest'
import {
  aniosValidos,
  esPublicoEnGeneral,
  esRfcGenerico,
  mesesValidos,
  periodoDeLaVenta,
} from './informacionGlobal'

const MESES = Array.from({ length: 18 }, (_, i) => ({ clave: String(i + 1).padStart(2, '0') }))

describe('informacionGlobal', () => {
  it('es global con el RFC genérico y el nombre PUBLICO EN GENERAL', () => {
    expect(esPublicoEnGeneral('xaxx010101000 ', 'publico  en general')).toBe(true)
    expect(esPublicoEnGeneral('XAXX010101000', 'ERIKA SANCHEZ')).toBe(false)
    expect(esRfcGenerico('XAXX010101000')).toBe(true)
  })

  it('los bimestres solo con periodicidad bimestral', () => {
    expect(mesesValidos(MESES, '04').map((m) => m.clave)).toHaveLength(12)
    expect(mesesValidos(MESES, '05').map((m) => m.clave)).toEqual([
      '13',
      '14',
      '15',
      '16',
      '17',
      '18',
    ])
  })

  it('propone diario con el mes de la venta en hora de México', () => {
    expect(periodoDeLaVenta('2026-10-31T16:34:21-06:00')).toEqual({
      periodicidad: '01',
      meses: '10',
      anio: 2026,
    })
    // 1 de noviembre a las 2 a.m. UTC: en México todavía es 31 de octubre.
    expect(periodoDeLaVenta('2026-11-01T02:00:00Z').meses).toBe('10')
  })

  it('el año en curso y el anterior', () => {
    expect(aniosValidos(new Date('2026-11-13T12:00:00Z'))).toEqual([2026, 2025])
  })
})
