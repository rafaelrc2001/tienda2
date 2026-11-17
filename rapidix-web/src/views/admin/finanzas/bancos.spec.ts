import { describe, expect, it } from 'vitest'
import type { MovimientoBancario } from '@/api/tipos'
import {
  cantidadBancaria,
  cantidadDeProducto,
  errorDeCantidad,
  ordenarMovimientos,
  siguienteOrden,
} from './bancos'

function mov(id: string, datos: Partial<MovimientoBancario>): MovimientoBancario {
  return {
    id,
    fecha: '2026-11-03',
    factura: null,
    cantidad: 100,
    metodo: 'TRANSFERENCIA',
    referencia: null,
    facturaGlobalId: null,
    ...datos,
  }
}

describe('ordenarMovimientos', () => {
  const lista = [
    mov('a', { fecha: '2026-11-05', factura: 'F10', cantidad: -50, metodo: 'EFECTIVO' }),
    mov('b', { fecha: '2026-11-03', factura: null, cantidad: 300 }),
    mov('c', { fecha: '2026-11-04', factura: 'F9', cantidad: 20 }),
    mov('d', { fecha: '2026-11-03', factura: 'a1159', cantidad: 8000 }),
  ]
  const ids = (m: MovimientoBancario[]) => m.map((x) => x.id)

  it('sin orden deja el de captura y no toca el original', () => {
    const copia = ordenarMovimientos(lista, null)
    expect(ids(copia)).toEqual(['a', 'b', 'c', 'd'])
    expect(copia).not.toBe(lista)
  })

  it('ordena por fecha y conserva el orden de captura en los empates', () => {
    expect(ids(ordenarMovimientos(lista, { columna: 'fecha', direccion: 'asc' }))).toEqual([
      'b',
      'd',
      'c',
      'a',
    ])
    expect(ids(ordenarMovimientos(lista, { columna: 'fecha', direccion: 'desc' }))).toEqual([
      'a',
      'c',
      'b',
      'd',
    ])
  })

  it('ordena la cantidad como número, con los negativos primero', () => {
    expect(ids(ordenarMovimientos(lista, { columna: 'cantidad', direccion: 'asc' }))).toEqual([
      'a',
      'c',
      'b',
      'd',
    ])
  })

  it('ordena folios con números naturales y deja los vacíos al final en las dos direcciones', () => {
    expect(ids(ordenarMovimientos(lista, { columna: 'factura', direccion: 'asc' }))).toEqual([
      'd',
      'c',
      'a',
      'b',
    ])
    expect(ids(ordenarMovimientos(lista, { columna: 'factura', direccion: 'desc' }))).toEqual([
      'a',
      'c',
      'd',
      'b',
    ])
  })

  it('ordena el método por su nombre', () => {
    expect(ids(ordenarMovimientos(lista, { columna: 'metodo', direccion: 'asc' }))[0]).toBe('a')
  })
})

describe('siguienteOrden', () => {
  it('va de ascendente a descendente y vuelve al orden de captura', () => {
    const asc = siguienteOrden(null, 'fecha')
    expect(asc).toEqual({ columna: 'fecha', direccion: 'asc' })
    const desc = siguienteOrden(asc, 'fecha')
    expect(desc).toEqual({ columna: 'fecha', direccion: 'desc' })
    expect(siguienteOrden(desc, 'fecha')).toBeNull()
  })

  it('otra columna empieza en ascendente', () => {
    expect(siguienteOrden({ columna: 'fecha', direccion: 'desc' }, 'factura')).toEqual({
      columna: 'factura',
      direccion: 'asc',
    })
  })
})

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
  it('acepta números enteros', () => {
    expect(cantidadDeProducto('6')).toBe(6)
    expect(cantidadDeProducto(' 12 ')).toBe(12)
  })

  it('rechaza decimales, cero, negativos y letras', () => {
    expect(cantidadDeProducto('1.5')).toBeNull()
    expect(cantidadDeProducto('0,250')).toBeNull()
    expect(cantidadDeProducto('2.0')).toBeNull()
    expect(cantidadDeProducto('0')).toBeNull()
    expect(cantidadDeProducto('-2')).toBeNull()
    expect(cantidadDeProducto('dos')).toBeNull()
    expect(cantidadDeProducto('')).toBeNull()
  })
})
