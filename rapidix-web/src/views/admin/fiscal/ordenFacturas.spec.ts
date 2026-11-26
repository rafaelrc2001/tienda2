import { describe, expect, it } from 'vitest'
import type { FacturaEmitida } from '@/api/tipos'
import { ordenarFacturas, siguienteOrdenFacturas } from './ordenFacturas'

function factura(datos: Partial<FacturaEmitida> & { id: string }): FacturaEmitida {
  return {
    tipo: 'PEDIDO',
    serieFolio: 'F-1',
    uuid: datos.id,
    rfc: 'XAXX010101000',
    nombre: 'CLIENTE',
    formaPago: { clave: '03', nombre: 'Transferencia' },
    total: 100,
    timbradaEn: '2026-11-01T12:00:00.000Z',
    creadaEn: '2026-11-01T12:00:00.000Z',
    creadoPor: null,
    emisor: null,
    pedidos: [],
    modo: 'SIMULADO',
    archivo: datos.id,
    ...datos,
  }
}

const ids = (lista: FacturaEmitida[]) => lista.map((f) => f.id)

describe('ordenarFacturas', () => {
  const facturas = [
    factura({ id: 'a', serieFolio: 'F-9', total: 50, creadoPor: { nombre: 'Zoe', rol: null } }),
    factura({ id: 'b', serieFolio: 'F-10', total: 300 }),
    factura({ id: 'c', serieFolio: 'F-2', total: 120, creadoPor: { nombre: 'Ana', rol: null } }),
  ]

  it('sin orden deja el de llegada y no toca el arreglo', () => {
    const resultado = ordenarFacturas(facturas, null)
    expect(ids(resultado)).toEqual(['a', 'b', 'c'])
    expect(resultado).not.toBe(facturas)
  })

  it('ordena el folio por número, no como texto', () => {
    expect(ids(ordenarFacturas(facturas, { columna: 'serieFolio', direccion: 'asc' }))).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('ordena el total como número, también descendente', () => {
    expect(ids(ordenarFacturas(facturas, { columna: 'total', direccion: 'desc' }))).toEqual([
      'b',
      'c',
      'a',
    ])
  })

  it('las vacías van al final en las dos direcciones', () => {
    expect(ids(ordenarFacturas(facturas, { columna: 'creo', direccion: 'asc' }))).toEqual([
      'c',
      'a',
      'b',
    ])
    expect(ids(ordenarFacturas(facturas, { columna: 'creo', direccion: 'desc' }))).toEqual([
      'a',
      'c',
      'b',
    ])
  })
})

describe('siguienteOrdenFacturas', () => {
  it('ascendente, descendente y de vuelta al de llegada', () => {
    const uno = siguienteOrdenFacturas(null, 'total')
    expect(uno).toEqual({ columna: 'total', direccion: 'asc' })
    const dos = siguienteOrdenFacturas(uno, 'total')
    expect(dos).toEqual({ columna: 'total', direccion: 'desc' })
    expect(siguienteOrdenFacturas(dos, 'total')).toBeNull()
    expect(siguienteOrdenFacturas(dos, 'rfc')).toEqual({ columna: 'rfc', direccion: 'asc' })
  })
})
