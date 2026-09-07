import { describe, expect, it } from 'vitest'
import { normalizarRegla, operadoresDe, operadorValido } from './segmentos'
import { ATRIBUTOS_SEGMENTO, type AtributoSegmento } from '@/api/tipos'

const NUMERICOS: AtributoSegmento[] = [
  'pedidos',
  'totalGastado',
  'diasSinComprar',
  'diasComoCliente',
  'mesCumpleanos',
]
const TEXTO: AtributoSegmento[] = ['ciudad', 'estado']

describe('operadoresDe', () => {
  /** Criterio de aceptación: `contiene` no se ofrece para los cinco numéricos. */
  it.each(NUMERICOS)('no ofrece "contiene" para %s', (attr) => {
    expect(operadoresDe(attr)).not.toContain('contiene')
  })

  it.each(TEXTO)('ofrece "contiene" para %s', (attr) => {
    expect(operadoresDe(attr)).toContain('contiene')
  })

  it('siempre ofrece los cinco comparadores', () => {
    for (const attr of ATRIBUTOS_SEGMENTO) {
      expect(operadoresDe(attr)).toEqual(expect.arrayContaining(['>', '>=', '<', '<=', '=']))
    }
  })

  it('deja seis operadores en texto y cinco en número', () => {
    expect(operadoresDe('ciudad')).toHaveLength(6)
    expect(operadoresDe('pedidos')).toHaveLength(5)
  })
})

describe('operadorValido', () => {
  it('acepta "contiene" solo sobre ciudad y estado', () => {
    expect(operadorValido('ciudad', 'contiene')).toBe(true)
    expect(operadorValido('estado', 'contiene')).toBe(true)
    expect(operadorValido('totalGastado', 'contiene')).toBe(false)
  })

  it('acepta los comparadores sobre cualquier atributo', () => {
    expect(operadorValido('pedidos', '>')).toBe(true)
    expect(operadorValido('ciudad', '=')).toBe(true)
  })
})

describe('normalizarRegla', () => {
  /**
   * Cambiar el atributo de una regla que usaba `contiene` no puede dejar una
   * regla que el backend rechazaría.
   */
  it('cae a "=" si el operador dejó de valer al cambiar el atributo', () => {
    const regla = normalizarRegla({ attr: 'pedidos', op: 'contiene', value: '5' })

    expect(regla.op).toBe('=')
    expect(regla.attr).toBe('pedidos')
    expect(regla.value).toBe('5')
  })

  it('deja intacta una regla que ya es válida', () => {
    const original = { attr: 'totalGastado', op: '>', value: '1000' } as const
    expect(normalizarRegla(original)).toBe(original)
  })

  it('conserva "contiene" sobre un atributo de texto', () => {
    const original = { attr: 'ciudad', op: 'contiene', value: 'Villahermosa' } as const
    expect(normalizarRegla(original)).toBe(original)
  })
})
