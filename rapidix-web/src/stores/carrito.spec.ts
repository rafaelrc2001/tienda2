import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El store llama a la API a través de `http`, así que se sustituye. Lo que se
 * prueba aquí es la lógica del carrito, no la red.
 */
const post = vi.fn()
const get = vi.fn()
const put = vi.fn()
vi.mock('@/api/http', () => ({
  http: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: vi.fn(),
    put: (...args: unknown[]) => put(...args),
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
  get.mockReset()
  put.mockReset()
  put.mockResolvedValue(undefined)
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

  /**
   * HU-07. El tope solo lo manda la Tienda cuando el negocio descuenta
   * existencias; sin él la cantidad no se limita, que es el caso de una tienda
   * con el control de inventario apagado.
   */
  it('topa la cantidad al saldo cuando la Tienda lo manda', () => {
    const carrito = useCarritoStore()

    carrito.fijarCantidad('p1', 20, 8)
    expect(carrito.cantidadDe('p1')).toBe(8)

    carrito.agregar('p1', 8)
    expect(carrito.cantidadDe('p1')).toBe(8)

    carrito.fijarCantidad('p2', 20)
    expect(carrito.cantidadDe('p2')).toBe(20)
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

describe('carrito · sincronización con el servidor (HU-13)', () => {
  /** Dos personas en el mismo teléfono: nadie hereda la compra de la otra. */
  it('descarta el carrito de otro usuario al abrir sesión', async () => {
    localStorage.setItem(
      CLAVE,
      JSON.stringify({
        lineas: [{ productoId: 'p1', cantidad: 3 }],
        codigoCupon: 'BIENV',
        duenio: 'cliente-antiguo',
      }),
    )
    setActivePinia(createPinia())
    get.mockResolvedValue({ items: [], actualizadoEn: null })

    const carrito = useCarritoStore()
    await carrito.adoptar('cliente-nuevo')

    expect(carrito.vacio).toBe(true)
    expect(carrito.codigoCupon).toBeNull()
    expect(carrito.duenio).toBe('cliente-nuevo')
  })

  /** HU-14: lo que armó antes de entrar es suyo y se conserva. */
  it('conserva el carrito armado sin sesión y lo sube', async () => {
    const carrito = useCarritoStore()
    carrito.agregar('p1')
    carrito.agregar('p1')

    await carrito.adoptar('cliente-1')

    expect(carrito.cantidadDe('p1')).toBe(2)
    expect(get).not.toHaveBeenCalled()

    vi.useFakeTimers()
    carrito.agregar('p1')
    vi.advanceTimersByTime(2000)
    vi.useRealTimers()

    expect(put).toHaveBeenCalledWith('/perfil/carrito', {
      items: [{ productoId: 'p1', cantidad: 3 }],
    })
  })

  it('recupera el carrito del servidor cuando el navegador no tiene ninguno', async () => {
    get.mockResolvedValue({
      items: [{ productoId: 'p7', cantidad: 5 }],
      actualizadoEn: '2026-09-01T10:00:00.000Z',
    })
    post.mockResolvedValue({ items: [], subtotal: 120, avisos: [] })

    const carrito = useCarritoStore()
    await carrito.adoptar('cliente-1')

    expect(get).toHaveBeenCalledWith('/perfil/carrito')
    expect(carrito.cantidadDe('p7')).toBe(5)
  })

  /** Cerrar sesión borra el rastro del navegador, no la copia del servidor. */
  it('olvida el carrito sin tocar el del servidor', async () => {
    const carrito = useCarritoStore()
    await carrito.adoptar('cliente-1')
    carrito.agregar('p1')

    vi.useFakeTimers()
    carrito.olvidar()
    vi.advanceTimersByTime(2000)
    vi.useRealTimers()

    expect(carrito.vacio).toBe(true)
    expect(carrito.duenio).toBeNull()
    expect(put).not.toHaveBeenCalled()
  })

  /** Widget «Mi carrito», HU-06: las tres capas, sin esperar al debounce. */
  it('vacía el carrito y el del servidor en el acto', async () => {
    const carrito = useCarritoStore()
    await carrito.adoptar('cliente-1')
    carrito.agregar('p1')

    await carrito.vaciarAhora()

    expect(carrito.vacio).toBe(true)
    expect(JSON.parse(localStorage.getItem(CLAVE)!).lineas).toEqual([])
    expect(put).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledWith('/perfil/carrito', { items: [] })
  })

  it('vacía lo local aunque falle la red', async () => {
    put.mockRejectedValue(new Error('sin red'))
    const carrito = useCarritoStore()
    await carrito.adoptar('cliente-1')
    carrito.agregar('p1')

    await expect(carrito.vaciarAhora()).resolves.toBeUndefined()
    expect(carrito.vacio).toBe(true)
  })

  it('sin sesión no llama al servidor al vaciar', async () => {
    const carrito = useCarritoStore()
    carrito.agregar('p1')

    await carrito.vaciarAhora()

    expect(carrito.vacio).toBe(true)
    expect(put).not.toHaveBeenCalled()
  })
})

describe('carrito · importe sin sesión (HU-11)', () => {
  /**
   * `previsualizar` exige ser cliente: el visitante pide solo lo que suman los
   * productos. Lo que no hace en ningún caso es multiplicar precios aquí.
   */
  it('pide el subtotal público mientras no hay dueño', async () => {
    post.mockResolvedValue({
      items: [],
      subtotal: 74.5,
      cashbackEstimado: 0,
      metas: { faltaEnvioGratis: 525.49, faltaCashback: null, sinCashback: false },
      avisos: [],
    })

    const carrito = useCarritoStore()
    carrito.agregar('p1')
    await carrito.refrescarImporte()

    expect(post).toHaveBeenCalledWith('/carrito/subtotal', {
      items: [{ productoId: 'p1', cantidad: 1 }],
    })
    expect(carrito.subtotal).toBe(74.5)
    expect(carrito.cashbackEstimado).toBe(0)
    expect(carrito.metas?.faltaEnvioGratis).toBe(525.49)
  })

  it('solo da el precio escalonado de la cantidad que hay ahora', async () => {
    post.mockResolvedValue({
      items: [
        {
          productoId: 'p1',
          precioUnitario: 18.5,
          cantidad: 5,
          importe: 92.5,
          agotado: false,
          precioLista: 19.95,
          ahorro: 7.25,
          upsell: null,
        },
      ],
      subtotal: 92.5,
      cashbackEstimado: 0,
      metas: null,
      avisos: [],
    })

    const carrito = useCarritoStore()
    carrito.fijarCantidad('p1', 5)
    await carrito.refrescarImporte()
    expect(carrito.lineaCalculada('p1')?.precioUnitario).toBe(18.5)

    // La respuesta ya no corresponde: la tarjeta vuelve al precio de venta
    // hasta que llegue la nueva, en vez de enseñar la oferta de antes.
    carrito.agregar('p1')
    expect(carrito.lineaCalculada('p1')).toBeNull()
  })

  it('pide el desglose completo en cuanto hay sesión', async () => {
    get.mockResolvedValue({ items: [], actualizadoEn: null })
    post.mockResolvedValue(previsualizacion({ subtotal: 300, cashbackEstimado: 6 }))

    const carrito = useCarritoStore()
    carrito.agregar('p1')
    await carrito.adoptar('cliente-1')
    await carrito.refrescarImporte()

    expect(post).toHaveBeenCalledWith('/carrito/previsualizar', {
      items: [{ productoId: 'p1', cantidad: 1 }],
      codigoCupon: undefined,
    })
    expect(carrito.subtotal).toBe(300)
    expect(carrito.cashbackEstimado).toBe(6)
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
