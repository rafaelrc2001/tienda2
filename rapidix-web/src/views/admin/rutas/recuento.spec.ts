import { describe, expect, it } from 'vitest'
import {
  itemsDeLaEntrega,
  pendientesParaConfirmar,
  piezasDelRecuento,
  problemaDelRecuento,
} from './recuento'
import type { RenglonContado } from './recuento'

/** Dos renglones en el camión: 10 tomates y 3 lechugas. */
const camion = (): RenglonContado[] => [
  {
    pedidoItemId: 'a',
    nombre: 'Tomate bola',
    cantidadCargada: 10,
    cantidadEntregada: 10,
    motivoDevolucion: null,
  },
  {
    pedidoItemId: 'b',
    nombre: 'Lechuga romana',
    cantidadCargada: 3,
    cantidadEntregada: 3,
    motivoDevolucion: null,
  },
]

describe('el conteo de lo que baja del camión', () => {
  it('cuenta lo aceptado y deja lo demás arriba', () => {
    const renglones = camion()
    renglones[0].cantidadEntregada = 6
    expect(piezasDelRecuento(renglones)).toEqual({ entregadas: 9, devueltas: 4 })
  })

  it('la entrega completa no devuelve nada', () => {
    expect(piezasDelRecuento(camion())).toEqual({ entregadas: 13, devueltas: 0 })
  })
})

describe('lo que impide cerrar la entrega', () => {
  it('deja pasar el recuento completo', () => {
    expect(problemaDelRecuento(camion())).toBeNull()
  })

  it('no admite más piezas de las que subieron', () => {
    const renglones = camion()
    renglones[1].cantidadEntregada = 4
    expect(problemaDelRecuento(renglones)).toContain('subiste 3 pieza(s)')
  })

  it('pide el motivo en cuanto sobra una sola pieza', () => {
    const renglones = camion()
    renglones[0].cantidadEntregada = 9
    expect(problemaDelRecuento(renglones)).toContain('Tomate bola')

    renglones[0].motivoDevolucion = 'DANADO'
    expect(problemaDelRecuento(renglones)).toBeNull()
  })

  it('manda a «No entregado» lo que no dejó nada', () => {
    const renglones = camion().map((r) => ({
      ...r,
      cantidadEntregada: 0,
      motivoDevolucion: 'NO_LO_QUISO' as const,
    }))
    expect(problemaDelRecuento(renglones)).toContain('No entregado')
  })

  it('avisa cuando no hay nada que contar', () => {
    expect(problemaDelRecuento([])).toContain('no va en tu camión')
  })

  it('rechaza el campo en blanco antes de mandarlo', () => {
    const renglones = camion()
    renglones[0].cantidadEntregada = Number.NaN
    expect(problemaDelRecuento(renglones)).toContain('cuántas piezas')
  })
})

describe('lo que falta para confirmar', () => {
  const lista = { conFoto: true, fotoExigible: true, cubre: true }

  it('con todo contado, la foto y el pago, no falta nada', () => {
    expect(pendientesParaConfirmar({ ...lista, renglones: camion() })).toEqual([])
  })

  it('junta todo lo pendiente de una vez, en el orden de la puerta', () => {
    const renglones = camion().map((r) => ({ ...r, cantidadEntregada: 0 }))
    expect(
      pendientesParaConfirmar({ renglones, conFoto: false, fotoExigible: true, cubre: false }),
    ).toEqual([
      'acepta al menos un producto',
      'falta la foto de evidencia',
      'el pago recibido no cubre el cobro',
    ])
  })

  it('pide el motivo solo cuando ya aceptó algo', () => {
    const renglones = camion()
    renglones[0].cantidadEntregada = 7
    expect(pendientesParaConfirmar({ ...lista, renglones })).toEqual([
      'di por qué no se quedó con todo «Tomate bola»',
    ])
  })

  it('sin almacenamiento de fotos no la exige', () => {
    expect(
      pendientesParaConfirmar({ ...lista, renglones: camion(), conFoto: false, fotoExigible: false }),
    ).toEqual([])
  })

  it('espera la cuenta de la API antes de dejar confirmar', () => {
    expect(pendientesParaConfirmar({ ...lista, renglones: camion(), cubre: null })).toEqual([
      'calculando el cobro',
    ])
  })
})

describe('el cuerpo que se manda', () => {
  it('lleva el motivo solo con lo que sobra', () => {
    const renglones = camion()
    renglones[0].cantidadEntregada = 6
    renglones[0].motivoDevolucion = 'NO_LO_QUISO'
    // El segundo se entregó completo: un motivo ahí sería MOTIVO_DE_MAS.
    renglones[1].motivoDevolucion = 'DANADO'

    expect(itemsDeLaEntrega(renglones)).toEqual([
      { pedidoItemId: 'a', cantidadEntregada: 6, motivoDevolucion: 'NO_LO_QUISO' },
      { pedidoItemId: 'b', cantidadEntregada: 3 },
    ])
  })
})
