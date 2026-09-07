import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El store llama a la API a través de `http`, así que se sustituye. Lo que se
 * prueba aquí es la lógica del carrito, no la red.
 */
const post = vi.fn()
vi.mock('@/api/http', () => ({
  http: {
    get: vi.fn(),
    post: (...args: unknown[]) => post(...args),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

import { useCarritoStore } from './carrito'

const CLAVE = 'rapidix.carrito'

/** Previsualización mínima con la forma que devuelve la API. */
function previsualizacion(sobre: Record<string, unknown> = {}) {
  return {
    items: [],
    subtotal: 100,
    envio: 0,
    recargoFuera: 0,
    descuento: 0,
    total: 100,
    cashbackEstimado: 2,
    cupon: null,
    dentroDeHorario: true,
    puedePedir: true,
    avisos: [],
    ...sobre,
  }
}

beforeEach(() => {
  localStorage.clear()
  post.mockReset()
  setActivePinia(createPinia())
})

describe('carrito · cantidades', () => {
  it('empieza vacío', () => {
    const carrito = useCarritoStore()
    expect(carrito.vacio).toBe(true)
    expect(carrito.totalPiezas).toBe(0)
  })

  it('agrega y acumula el mismo producto en una sola línea', () => {
    const carrito = useCarritoStore()
    carrito.agregar('p1')
    carrito.agregar('p1')
    carrito.agregar('p2')

    expect(carrito.lineas).toHaveLength(2)
    expect(carrito.cantidadDe('p1')).toBe(2)
    expect(carrito.totalPiezas).toBe(3)
  })

  it('quita la línea al bajar a cero, en vez de dejarla en 0', () => {
    const carrito = useCarritoStore()
    carrito.agregar('p1')
    carrito.quitar('p1')

    expect(carrito.cantidadDe('p1')).toBe(0)
    expect(carrito.lineas).toHaveLength(0)
    expect(carrito.vacio).toBe(true)
  })

  it('no deja cantidades negativas', () => {
    const carrito = useCarritoStore()
    carrito.fijarCantidad('p1', -3)
    expect(carrito.lineas).toHaveLength(0)
  })
})

describe('carrito · persistencia', () => {
  /**
   * Decisión del SPEC 02: se guardan solo ids y cantidades. Un carrito que
   * sobrevive tres días no puede llevar precios congelados dentro.
   */
  it('persiste solo productoId y cantidad, nunca precios', () => {
    const carrito = useCarritoStore()
    carrito.agregar('p1')
    carrito.agregar('p1')

    const guardado = JSON.parse(localStorage.getItem(CLAVE) as string)

    expect(guardado.lineas).toEqual([{ productoId: 'p1', cantidad: 2 }])
    expect(JSON.stringify(guardado)).not.toMatch(/precio/i)
  })

  it('recupera el carrito de una sesión anterior', () => {
    localStorage.setItem(
      CLAVE,
      JSON.stringify({ lineas: [{ productoId: 'p9', cantidad: 4 }], codigoCupon: 'BIENV' }),
    )
    setActivePinia(createPinia())

    const carrito = useCarritoStore()
    expect(carrito.cantidadDe('p9')).toBe(4)
    expect(carrito.codigoCupon).toBe('BIENV')
  })

  it('ignora un carrito guardado corrupto en vez de romper el arranque', () => {
    localStorage.setItem(CLAVE, 'esto no es json')
    setActivePinia(createPinia())

    expect(useCarritoStore().vacio).toBe(true)
  })

  it('descarta las líneas mal formadas del almacenamiento', () => {
    localStorage.setItem(
      CLAVE,
      JSON.stringify({
        lineas: [
          { productoId: 'p1', cantidad: 2 },
          { productoId: 'p2', cantidad: 0 },
          { productoId: 123, cantidad: 1 },
          { cantidad: 5 },
        ],
        codigoCupon: null,
      }),
    )
    setActivePinia(createPinia())

    expect(useCarritoStore().lineas).toEqual([{ productoId: 'p1', cantidad: 2 }])
  })
})

describe('carrito · previsualización', () => {
  it('pide el desglose a la API y no calcula nada por su cuenta', async () => {
    post.mockResolvedValue(previsualizacion({ subtotal: 250, envio: 40, total: 290 }))

    const carrito = useCarritoStore()
    carrito.agregar('p1')
    await carrito.recalcular()

    expect(post).toHaveBeenCalledWith('/carrito/previsualizar', {
      items: [{ productoId: 'p1', cantidad: 1 }],
      codigoCupon: undefined,
    })
    expect(carrito.previsualizacion?.total).toBe(290)
  })

  it('limpia el desglose cuando el carrito se queda vacío', async () => {
    post.mockResolvedValue(previsualizacion())

    const carrito = useCarritoStore()
    carrito.agregar('p1')
    await carrito.recalcular()
    expect(carrito.previsualizacion).not.toBeNull()

    carrito.quitar('p1')
    await carrito.recalcular()

    expect(carrito.previsualizacion).toBeNull()
    expect(post).toHaveBeenCalledTimes(1)
  })

  /**
   * Pulsar "+" varias veces lanza varias peticiones: si vuelven desordenadas,
   * solo la última puede mandar sobre el total que se enseña.
   */
  it('descarta la respuesta de una petición vieja', async () => {
    const carrito = useCarritoStore()
    carrito.agregar('p1')

    let resolverPrimera: (valor: unknown) => void = () => {}
    post
      .mockImplementationOnce(
        () =>
          new Promise((resolver) => {
            resolverPrimera = resolver
          }),
      )
      .mockResolvedValueOnce(previsualizacion({ total: 999 }))

    const primera = carrito.recalcular()
    const segunda = carrito.recalcular()

    await segunda
    resolverPrimera(previsualizacion({ total: 111 }))
    await primera

    expect(carrito.previsualizacion?.total).toBe(999)
  })

  it('marca el cupón como no aplicable si la API lo devuelve sin cupón', async () => {
    post.mockResolvedValue(
      previsualizacion({ cupon: null, avisos: ['Te faltan $50.00 para llegar al mínimo'] }),
    )

    const carrito = useCarritoStore()
    carrito.agregar('p1')
    carrito.codigoCupon = 'BIENV'
    await carrito.recalcular()

    expect(carrito.errorCupon).toBe('Te faltan $50.00 para llegar al mínimo')
  })
})

describe('carrito · cupón', () => {
  it('normaliza el código a mayúsculas y sin espacios', async () => {
    post
      .mockResolvedValueOnce({ valido: true, cuponId: 'c1', codigo: 'BIENV', titulo: 'Bienvenida', subtotal: 100, descuento: 10 })
      .mockResolvedValueOnce(previsualizacion({ cupon: { codigo: 'BIENV', descripcion: 'Bienvenida' } }))

    const carrito = useCarritoStore()
    carrito.agregar('p1')
    const aplicado = await carrito.aplicarCupon('  bienv  ')

    expect(aplicado).toBe(true)
    expect(carrito.codigoCupon).toBe('BIENV')
    expect(post).toHaveBeenCalledWith('/carrito/validar-cupon', {
      codigo: 'BIENV',
      items: [{ productoId: 'p1', cantidad: 1 }],
    })
  })

  /** Un cupón rechazado no es un error de red: su motivo va bajo el campo. */
  it('guarda el motivo del rechazo en vez de lanzar', async () => {
    post.mockResolvedValue({
      valido: false,
      motivo: 'MINIMO_NO_ALCANZADO',
      mensaje: 'Te faltan $50.00 para llegar al mínimo',
      subtotal: 100,
    })

    const carrito = useCarritoStore()
    carrito.agregar('p1')
    const aplicado = await carrito.aplicarCupon('BIENV')

    expect(aplicado).toBe(false)
    expect(carrito.codigoCupon).toBeNull()
    expect(carrito.errorCupon).toBe('Te faltan $50.00 para llegar al mínimo')
  })

  it('ignora un código vacío sin llamar a la API', async () => {
    const carrito = useCarritoStore()
    expect(await carrito.aplicarCupon('   ')).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })
})

describe('carrito · confirmar pedido', () => {
  it('vacía el carrito solo después de que la API cree el pedido', async () => {
    post.mockResolvedValue({ id: 'o1', folio: 'ORD-000001', total: 290 })

    const carrito = useCarritoStore()
    carrito.agregar('p1')
    const pedido = await carrito.confirmar()

    expect(pedido.folio).toBe('ORD-000001')
    expect(carrito.vacio).toBe(true)
    expect(carrito.codigoCupon).toBeNull()
    expect(carrito.previsualizacion).toBeNull()
    expect(JSON.parse(localStorage.getItem(CLAVE) as string).lineas).toEqual([])
  })

  /** Si la API rechaza, el cliente conserva lo que había armado. */
  it('conserva el carrito si la confirmación falla', async () => {
    post.mockRejectedValue(new Error('409'))

    const carrito = useCarritoStore()
    carrito.agregar('p1')
    carrito.agregar('p2')

    await expect(carrito.confirmar()).rejects.toThrow()

    expect(carrito.vacio).toBe(false)
    expect(carrito.totalPiezas).toBe(2)
  })
})
