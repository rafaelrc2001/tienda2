import { describe, expect, it } from 'vitest'
import { diasHasta, dinero, fecha, fechaHora } from './formato'

describe('dinero', () => {
  it('formatea con símbolo, miles y dos decimales', () => {
    expect(dinero(1234.5)).toContain('1,234.50')
    expect(dinero(1234.5)).toContain('$')
  })

  it('siempre pinta dos decimales, aunque el monto sea entero', () => {
    expect(dinero(80)).toContain('80.00')
  })

  it('formatea el cero en vez de dejar el hueco vacío', () => {
    expect(dinero(0)).toContain('0.00')
  })

  it('conserva el signo de un monto negativo', () => {
    expect(dinero(-50)).toContain('50.00')
    expect(dinero(-50)).toMatch(/-|−/)
  })

  /**
   * Un `total` que llega como `undefined` por un fallo de la API no puede
   * pintar "$NaN" en la barra del carrito.
   */
  it('trata un valor no finito como cero', () => {
    expect(dinero(Number.NaN)).toContain('0.00')
    expect(dinero(Number.POSITIVE_INFINITY)).toContain('0.00')
  })
})

describe('fecha', () => {
  it('formatea una fecha ISO en día, mes y año', () => {
    const resultado = fecha('2026-09-07T12:00:00.000Z')
    expect(resultado).toMatch(/2026/)
    expect(resultado).not.toBe('')
  })

  it('devuelve cadena vacía sin fecha, para no pintar "null"', () => {
    expect(fecha(null)).toBe('')
    expect(fecha(undefined)).toBe('')
    expect(fecha('')).toBe('')
  })

  it('devuelve cadena vacía si la fecha no es válida', () => {
    expect(fecha('no-es-una-fecha')).toBe('')
  })
})

describe('fechaHora', () => {
  it('añade la hora a la fecha', () => {
    const resultado = fechaHora('2026-09-07T12:30:00.000Z')
    expect(resultado).toMatch(/2026/)
    expect(resultado).toMatch(/\d{2}:\d{2}/)
  })

  it('devuelve cadena vacía si la fecha no es válida', () => {
    expect(fechaHora('vacío')).toBe('')
  })
})

describe('diasHasta', () => {
  const EN_UN_DIA = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const HACE_TRES_DIAS = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

  it('cuenta los días que faltan', () => {
    expect(diasHasta(EN_UN_DIA)).toBe(1)
  })

  /** El estado del cupón depende de este signo: vencido va en negativo. */
  it('devuelve negativo si la fecha ya pasó', () => {
    expect(diasHasta(HACE_TRES_DIAS)).toBeLessThan(0)
  })

  it('devuelve null sin fecha o con una inválida', () => {
    expect(diasHasta(null)).toBeNull()
    expect(diasHasta('mañana')).toBeNull()
  })
})
