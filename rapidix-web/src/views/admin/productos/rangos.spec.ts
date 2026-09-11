import { describe, expect, it } from 'vitest'
import { filaDelTecho, limiteInferior, limiteSuperior, moverPiso, moverTecho } from './rangos'
import type { FilaEscalon } from './rangos'

/** La tabla del mockup: 1–10 a 45, 11–15 a 30, 16 en adelante a 10. */
const tabla = (): FilaEscalon[] => [
  { piso: 11, precio: 30 },
  { piso: 16, precio: 10 },
]

/** Solo el precio de venta: las dos listas de volumen sin estrenar. */
const vacia = (): FilaEscalon[] => [
  { piso: null, precio: null },
  { piso: null, precio: null },
]

describe('lectura de los rangos', () => {
  it('deriva el techo de una lista del piso de la siguiente', () => {
    const escalones = tabla()
    expect(limiteSuperior(escalones, 0)).toBe(10)
    expect(limiteSuperior(escalones, 1)).toBe(15)
  })

  it('deja abierta la última lista', () => {
    expect(limiteSuperior(tabla(), 2)).toBeNull()
    expect(limiteSuperior(vacia(), 0)).toBeNull()
  })

  it('salta la lista vacía de en medio para poner el techo', () => {
    const escalones: FilaEscalon[] = [
      { piso: null, precio: null },
      { piso: 16, precio: 10 },
    ]
    expect(filaDelTecho(escalones, 0)).toBe(1)
    expect(limiteSuperior(escalones, 0)).toBe(15)
  })

  it('la lista 1 arranca siempre en la pieza 1', () => {
    expect(limiteInferior(tabla(), 0)).toBe(1)
    expect(limiteInferior(tabla(), 1)).toBe(11)
  })
})

describe('mover el techo de una lista', () => {
  it('escribe el piso de la siguiente, no un techo', () => {
    const escalones = tabla()
    expect(moverTecho(escalones, 0, 8)).toBe(8)
    expect(escalones[0].piso).toBe(9)
  })

  it('no deja que el techo se coma la lista de después', () => {
    const escalones = tabla()
    // Con la lista 3 en 16, la 2 no puede empezar más allá de 15.
    expect(moverTecho(escalones, 0, 40)).toBe(14)
    expect(escalones[0].piso).toBe(15)
    expect(escalones[1].piso).toBe(16)
  })

  it('no deja un rango al revés por debajo del propio piso', () => {
    const escalones = tabla()
    expect(moverTecho(escalones, 1, 3)).toBe(11)
    expect(escalones[1].piso).toBe(12)
  })

  it('estrena la lista siguiente cuando todavía no existe', () => {
    const escalones = vacia()
    expect(moverTecho(escalones, 0, 10)).toBe(10)
    expect(escalones[0].piso).toBe(11)
  })

  it('vaciar el campo abre la lista y borra la siguiente', () => {
    const escalones = tabla()
    expect(moverTecho(escalones, 1, null)).toBeNull()
    expect(escalones[1].piso).toBeNull()
  })

  it('la lista 1 no puede quedarse sin ninguna pieza', () => {
    const escalones = vacia()
    moverTecho(escalones, 0, 0)
    expect(escalones[0].piso).toBe(2)
  })
})

describe('mover el piso de una lista', () => {
  it('lo recorta contra la lista de arriba', () => {
    const escalones = tabla()
    expect(moverPiso(escalones, 0, 1)).toBe(2)
  })

  it('lo recorta contra la lista de abajo', () => {
    const escalones = tabla()
    // La lista 3 empieza en 16: la 2 no puede empezar ahí ni más arriba.
    expect(moverPiso(escalones, 0, 30)).toBe(15)
    expect(escalones[1].piso).toBe(16)
  })

  it('la lista 3 tiene que empezar después de la 2', () => {
    const escalones = tabla()
    expect(moverPiso(escalones, 1, 5)).toBe(12)
  })

  it('vaciarlo deja la lista sin estrenar', () => {
    const escalones = tabla()
    expect(moverPiso(escalones, 0, null)).toBeNull()
    expect(escalones[0].piso).toBeNull()
  })
})

describe('los rangos siempre cuadran', () => {
  /** Recorre la tabla y devuelve los rangos ya cerrados. */
  function rangos(escalones: FilaEscalon[]): [number, number | null][] {
    return [0, 1, 2]
      .filter((i) => i === 0 || !sinPiso(escalones[i - 1]))
      .map((i) => [limiteInferior(escalones, i), limiteSuperior(escalones, i)])
  }

  const sinPiso = (f: FilaEscalon): boolean => f.piso === null

  it('ni se enciman ni dejan huecos por mucho que se muevan los límites', () => {
    const escalones = vacia()
    const movimientos: (() => void)[] = [
      () => moverTecho(escalones, 0, 10),
      () => moverPiso(escalones, 1, 16),
      () => moverTecho(escalones, 0, 99),
      () => moverPiso(escalones, 0, 0),
      () => moverTecho(escalones, 1, 4),
      () => moverPiso(escalones, 1, 3),
      () => moverTecho(escalones, 0, 7),
    ]

    for (const mover of movimientos) {
      mover()
      let anterior: number | null = 0
      for (const [inferior, superior] of rangos(escalones)) {
        // Cada lista empieza justo donde acabó la de arriba: sin hueco ni solape.
        expect(inferior).toBe((anterior ?? 0) + 1)
        // Y ninguna se queda sin al menos una pieza que cobrar.
        if (superior !== null) expect(superior).toBeGreaterThanOrEqual(inferior)
        anterior = superior
      }
    }
  })
})
