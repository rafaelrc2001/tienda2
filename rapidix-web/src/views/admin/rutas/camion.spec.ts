import { describe, expect, it } from 'vitest'
import { inventarioDelCamion } from './camion'
import type { RenglonDeCarga } from '@/api/tipos'

const renglon = (
  pedidoItemId: string,
  productoId: string,
  nombre: string,
  cargada: number,
  entregada = 0,
  unidad = 'pz',
): RenglonDeCarga => ({
  pedidoItemId,
  productoId,
  nombre,
  unidad,
  cantidadCargada: cargada,
  cantidadEntregada: entregada,
  cantidadDevuelta: 0,
  precioUnitario: 10,
  precioEntregado: null,
  motivoDevolucion: null,
  enCamion: true,
})

describe('el inventario del camión', () => {
  it('suma lo recolectado y lo entregado de cada producto, y lo que sigue arriba', () => {
    const pedidos = [
      { carga: [renglon('a', 'tomate', 'Tomate', 10, 10), renglon('b', 'lechuga', 'Lechuga', 3)] },
      { carga: [renglon('c', 'tomate', 'Tomate', 5, 2)] },
    ]

    expect(inventarioDelCamion(pedidos)).toEqual([
      {
        productoId: 'lechuga',
        nombre: 'Lechuga',
        unidad: 'pz',
        recolectado: 3,
        entregado: 0,
        diferencia: 3,
      },
      {
        productoId: 'tomate',
        nombre: 'Tomate',
        unidad: 'pz',
        recolectado: 15,
        entregado: 12,
        diferencia: 3,
      },
    ])
  })

  it('no cuenta la carga de un viaje anterior del mismo pedido', () => {
    // Salió una vez, no se entregó y el corte lo bajó; ahora va de nuevo.
    const anterior = { ...renglon('a', 'tomate', 'Tomate', 10), enCamion: false }
    const pedidos = [{ carga: [anterior, renglon('a', 'tomate', 'Tomate', 10, 4)] }]

    expect(inventarioDelCamion(pedidos)[0]).toMatchObject({
      recolectado: 10,
      entregado: 4,
      diferencia: 6,
    })
  })

  it('no junta dos productos que se llaman igual pero son distintos', () => {
    const pedidos = [
      {
        carga: [
          renglon('a', 'azucar-kg', 'Azúcar', 2, 0, 'kg'),
          renglon('b', 'azucar-bulto', 'Azúcar', 1, 0, 'bulto'),
        ],
      },
    ]
    expect(inventarioDelCamion(pedidos)).toHaveLength(2)
  })

  it('sin carga no hay nada en el camión', () => {
    expect(inventarioDelCamion([{ carga: [] }])).toEqual([])
  })
})
