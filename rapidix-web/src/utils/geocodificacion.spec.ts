import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ESPACIO_MINIMO_MS, camposDesdeNominatim, crearGeocodificador } from './geocodificacion'

describe('camposDesdeNominatim', () => {
  it('traduce la dirección de OSM a los campos del formulario', () => {
    expect(
      camposDesdeNominatim({
        address: {
          road: 'Avenida Gregorio Méndez',
          house_number: '123',
          suburb: 'Centro',
          postcode: '86000',
          city: 'Villahermosa',
          state: 'Tabasco',
        },
      }),
    ).toEqual({
      calle: 'Avenida Gregorio Méndez 123',
      colonia: 'Centro',
      cp: '86000',
      ciudad: 'Villahermosa',
      estado: 'Tabasco',
    })
  })

  it('solo devuelve lo que viene, y descarta un CP que no es de 5 dígitos', () => {
    expect(
      camposDesdeNominatim({ address: { village: 'Tapijulapa', postcode: '86000-86999' } }),
    ).toEqual({ ciudad: 'Tapijulapa' })
    expect(camposDesdeNominatim({})).toEqual({})
  })
})

describe('crearGeocodificador', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('no encima peticiones: descarta las intermedias y respeta 1 por segundo', async () => {
    const respuestas: ((r: object) => void)[] = []
    const pedir = vi.fn(() => new Promise<object>((resolve) => respuestas.push(resolve)))
    const alTerminar = vi.fn()
    const geo = crearGeocodificador(alTerminar, () => {}, pedir)

    geo.buscar(1, 1)
    geo.buscar(2, 2)
    geo.buscar(3, 3)
    expect(pedir).toHaveBeenCalledTimes(1)

    // Llega la primera, pero ya hay un punto más nuevo: su resultado sobra.
    respuestas[0]({ address: { city: 'Vieja' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(alTerminar).not.toHaveBeenCalled()
    expect(pedir).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(ESPACIO_MINIMO_MS)
    expect(pedir).toHaveBeenCalledTimes(2)
    expect(pedir).toHaveBeenLastCalledWith(3, 3)

    respuestas[1]({ address: { city: 'Nueva' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(alTerminar).toHaveBeenCalledWith({ ciudad: 'Nueva' })
  })

  it('si el servicio falla entrega null y no lanza', async () => {
    const alTerminar = vi.fn()
    const ocupado = vi.fn()
    const geo = crearGeocodificador(alTerminar, ocupado, () => Promise.reject(new Error('red')))

    geo.buscar(1, 1)
    await vi.advanceTimersByTimeAsync(0)

    expect(alTerminar).toHaveBeenCalledWith(null)
    expect(ocupado).toHaveBeenLastCalledWith(false)
  })
})
