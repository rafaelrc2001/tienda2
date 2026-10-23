import { describe, expect, it } from 'vitest'
import { cantidadBancaria, cantidadDeProducto, errorDeCantidad } from './bancos'

describe('cantidadBancaria', () => {
  it('lee la coma seguida de tres dígitos como separador de miles', () => {
    expect(cantidadBancaria('6,750')).toBe(6750)
    expect(cantidadBancaria('29,445.00')).toBe(29445)
    expect(cantidadBancaria('1,234,567.89')).toBe(1234567.89)
  })

  it('lee la coma seguida de uno o dos dígitos como punto decimal', () => {
    expect(cantidadBancaria('12,5')).toBe(12.5)
    expect(cantidadBancaria('6,75')).toBe(6.75)
  })

  it('acepta el formato simple con o sin decimales', () => {
    expect(cantidadBancaria('6750')).toBe(6750)
    expect(cantidadBancaria('10.10')).toBe(10.1)
    expect(cantidadBancaria('0.5')).toBe(0.5)
  })

  it('acepta signo, $ y espacios como se copian del banco', () => {
    expect(cantidadBancaria('-4451.05')).toBe(-4451.05)
    expect(cantidadBancaria('-$4,451.05')).toBe(-4451.05)
    expect(cantidadBancaria('$-4,451.05')).toBe(-4451.05)
    expect(cantidadBancaria(' $ 6,750.00 ')).toBe(6750)
  })

  it('el cero se queda sin signo', () => {
    expect(Object.is(cantidadBancaria('-0'), 0)).toBe(true)
  })

  it('el campo vacío o en blanco no es cero', () => {
    expect(cantidadBancaria('')).toBeNull()
    expect(cantidadBancaria('   ')).toBeNull()
    expect(cantidadBancaria('-')).toBeNull()
    expect(cantidadBancaria('$')).toBeNull()
  })

  it('rechaza lo que no sabe leer en vez de adivinar', () => {
    expect(cantidadBancaria('1,234,5')).toBeNull()
    expect(cantidadBancaria('12,3456')).toBeNull()
    expect(cantidadBancaria('12.345')).toBeNull()
    expect(cantidadBancaria('1.234,50')).toBeNull()
    expect(cantidadBancaria('--5')).toBeNull()
    expect(cantidadBancaria('-$-5')).toBeNull()
    expect(cantidadBancaria('1e3')).toBeNull()
    expect(cantidadBancaria('0x10')).toBeNull()
    expect(cantidadBancaria('abc')).toBeNull()
  })
})

describe('errorDeCantidad', () => {
  it('pide el dato si el campo está vacío o en blanco', () => {
    expect(errorDeCantidad('', 'el saldo inicial')).toBe('Escribe el saldo inicial.')
    expect(errorDeCantidad('   ', 'el saldo inicial')).toBe('Escribe el saldo inicial.')
  })

  it('dice qué no entendió y cómo escribirlo', () => {
    expect(errorDeCantidad('29,445,00', 'la cantidad')).toBe(
      'No entiendo «29,445,00» como cantidad: escríbela como 6750.00 o 6,750.00.',
    )
  })

  it('no estorba con una cantidad válida, aunque sea cero', () => {
    expect(errorDeCantidad('6,750.00', 'la cantidad')).toBeNull()
    expect(errorDeCantidad('0', 'el saldo inicial')).toBeNull()
  })
})

describe('cantidadDeProducto', () => {
  it('acepta enteros y hasta tres decimales, con punto o coma', () => {
    expect(cantidadDeProducto('6')).toBe(6)
    expect(cantidadDeProducto(' 1.5 ')).toBe(1.5)
    expect(cantidadDeProducto('0,250')).toBe(0.25)
  })

  it('rechaza cero, negativos, letras y más de tres decimales', () => {
    expect(cantidadDeProducto('0')).toBeNull()
    expect(cantidadDeProducto('0.000')).toBeNull()
    expect(cantidadDeProducto('-2')).toBeNull()
    expect(cantidadDeProducto('dos')).toBeNull()
    expect(cantidadDeProducto('1.2345')).toBeNull()
    expect(cantidadDeProducto('')).toBeNull()
  })
})
