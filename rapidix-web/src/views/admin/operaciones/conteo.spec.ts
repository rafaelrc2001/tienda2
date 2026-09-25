import { describe, expect, it } from 'vitest'
import { sumarProductos } from './conteo'
import type { ItemPedido } from '@/api/tipos'

const item = (productoId: string, nombre: string, cantidad: number, unidad = 'pz'): ItemPedido => ({
  productoId,
  nombre,
  categoria: 'Abarrotes',
  unidad,
  precioUnitario: 10,
  cantidad,
  importe: 10 * cantidad,
})

describe('la libreta de Operaciones', () => {
  it('suma cada producto de todos los pedidos palomeados', () => {
    const pedido1 = { items: [item('azucar', 'Azúcar', 1), item('azul', 'Azul', 3)] }
    const pedido2 = {
      items: [item('otro', 'Otro', 1), item('otro', 'Otro', 1), item('azucar', 'Azúcar', 2)],
    }

    expect(sumarProductos([pedido1, pedido2]).map((p) => [p.nombre, p.cantidad])).toEqual([
      ['Azúcar', 3],
      ['Azul', 3],
      ['Otro', 2],
    ])
  })

  it('cuenta en cuántos pedidos aparece, aunque se repita dentro de uno', () => {
    const pedidos = [
      { items: [item('otro', 'Otro', 1), item('otro', 'Otro', 1)] },
      { items: [item('otro', 'Otro', 4)] },
    ]
    expect(sumarProductos(pedidos)[0]).toMatchObject({ cantidad: 6, pedidos: 2 })
  })

  it('no junta dos productos que se llaman igual pero son distintos', () => {
    const pedidos = [
      { items: [item('azucar-kg', 'Azúcar', 2, 'kg'), item('azucar-bulto', 'Azúcar', 1, 'bulto')] },
    ]
    expect(sumarProductos(pedidos)).toHaveLength(2)
  })

  it('sin pedidos no hay nada que contar', () => {
    expect(sumarProductos([])).toEqual([])
  })
})
