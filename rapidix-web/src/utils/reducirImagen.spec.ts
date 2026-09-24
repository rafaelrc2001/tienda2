import { describe, expect, it } from 'vitest'
import { LADO_MAXIMO, medidasReducidas } from './reducirImagen'

describe('medidasReducidas', () => {
  it('deja igual una imagen que ya cabe', () => {
    expect(medidasReducidas(1200, 900)).toEqual({ ancho: 1200, alto: 900 })
  })

  it('ajusta el lado mayor de una foto horizontal', () => {
    expect(medidasReducidas(4000, 3000)).toEqual({ ancho: LADO_MAXIMO, alto: 1200 })
  })

  it('ajusta el lado mayor de una foto vertical', () => {
    expect(medidasReducidas(3000, 4000)).toEqual({ ancho: 1200, alto: LADO_MAXIMO })
  })
})
