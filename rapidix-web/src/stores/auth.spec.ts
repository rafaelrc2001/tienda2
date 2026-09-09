import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El store habla con la API al abrir sesión, no al cerrarla. Aquí solo se
 * prueba el cierre, así que basta con que la red exista y no haga nada.
 */
vi.mock('@/api/http', () => ({
  CLAVE_TOKEN: 'rapidix.token',
  http: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/api/auth', () => ({
  apiAuth: {
    yo: vi.fn(),
    menu: vi.fn(),
    modo: vi.fn(),
    entrarDirecto: vi.fn(),
    solicitarCodigo: vi.fn(),
    verificarCodigo: vi.fn(),
    loginStaff: vi.fn(),
  },
}))

import { useAuthStore } from './auth'
import { useCarritoStore } from './carrito'

describe('cerrarSesion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  /**
   * El caso que motiva todo esto: dispositivo compartido. Si el carrito
   * sobrevive al cierre de sesión, el siguiente que entre se encuentra la
   * compra a medias del anterior.
   */
  it('no deja nada de la persona anterior en el navegador', () => {
    localStorage.setItem('rapidix.token', 'un-token')
    localStorage.setItem('rapidix.fuente', 'INSTAGRAM')

    const carrito = useCarritoStore()
    carrito.agregar('producto-1')
    expect(carrito.vacio).toBe(false)

    useAuthStore().cerrarSesion()

    expect(Object.keys(localStorage).filter((c) => c.startsWith('rapidix.'))).toEqual([])
    expect(carrito.vacio).toBe(true)
  })

  /** Lo que no lleva el prefijo no es nuestro y no se toca. */
  it('respeta lo que guardaron otros en el mismo navegador', () => {
    localStorage.setItem('rapidix.token', 'un-token')
    localStorage.setItem('otra-app.preferencias', 'oscuro')

    useAuthStore().cerrarSesion()

    expect(localStorage.getItem('otra-app.preferencias')).toBe('oscuro')
  })
})
