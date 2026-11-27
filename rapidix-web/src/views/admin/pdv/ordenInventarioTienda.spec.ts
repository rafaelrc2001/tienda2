import { describe, expect, it } from 'vitest'
import type { ExistenciaTienda } from '@/api/tipos'
import { ordenarInventarioTienda, siguienteOrdenInventarioTienda } from './ordenInventarioTienda'

function existencia(datos: Partial<ExistenciaTienda> & { productoId: string }): ExistenciaTienda {
  return {
    nombre: 'Producto',
    categoria: 'Envases',
    unidad: 'Pz',
    cantidad: 0,
    comprometido: 0,
    disponible: 0,
    habilitado: true,
    ...datos,
  }
}

const ids = (lista: ExistenciaTienda[]) => lista.map((e) => e.productoId)

describe('ordenarInventarioTienda', () => {
  const existencias = [
    existencia({ productoId: 'a', nombre: 'Botella 9', cantidad: 110, disponible: 100 }),
    existencia({ productoId: 'b', nombre: 'botella 10', cantidad: 383, disponible: 383 }),
    existencia({ productoId: 'c', nombre: 'Atomizador', cantidad: 17, disponible: 17 }),
  ]

  it('sin orden deja el de llegada y no toca el arreglo', () => {
    const resultado = ordenarInventarioTienda(existencias, null)
    expect(ids(resultado)).toEqual(['a', 'b', 'c'])
    expect(resultado).not.toBe(existencias)
  })

  it('ordena el producto sin distinguir mayúsculas y con números naturales', () => {
    expect(
      ids(ordenarInventarioTienda(existencias, { columna: 'producto', direccion: 'asc' })),
    ).toEqual(['c', 'a', 'b'])
  })

  it('ordena las cantidades como número, también descendente', () => {
    expect(
      ids(ordenarInventarioTienda(existencias, { columna: 'fisico', direccion: 'desc' })),
    ).toEqual(['b', 'a', 'c'])
    expect(
      ids(ordenarInventarioTienda(existencias, { columna: 'disponible', direccion: 'asc' })),
    ).toEqual(['c', 'a', 'b'])
  })

  it('los empates conservan el orden de llegada', () => {
    expect(
      ids(ordenarInventarioTienda(existencias, { columna: 'comprometido', direccion: 'desc' })),
    ).toEqual(['a', 'b', 'c'])
  })
})

describe('siguienteOrdenInventarioTienda', () => {
  it('ascendente, descendente y de vuelta al de llegada', () => {
    const uno = siguienteOrdenInventarioTienda(null, 'fisico')
    expect(uno).toEqual({ columna: 'fisico', direccion: 'asc' })
    const dos = siguienteOrdenInventarioTienda(uno, 'fisico')
    expect(dos).toEqual({ columna: 'fisico', direccion: 'desc' })
    expect(siguienteOrdenInventarioTienda(dos, 'fisico')).toBeNull()
    expect(siguienteOrdenInventarioTienda(dos, 'producto')).toEqual({
      columna: 'producto',
      direccion: 'asc',
    })
  })
})
