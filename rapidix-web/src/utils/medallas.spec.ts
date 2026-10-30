import { describe, expect, it } from 'vitest'
import { emojiDeNivel, imagenDeNivel } from './medallas'

describe('medallas de nivel', () => {
  it('reconoce el nivel sin importar cómo lo tecleó el negocio', () => {
    expect(emojiDeNivel('BRONCE')).toBe('🥉')
    expect(emojiDeNivel('Nivel Oro')).toBe('🥇')
  })

  it('no confunde Platino con Plata', () => {
    expect(emojiDeNivel('Platino')).toBe('💎')
    expect(imagenDeNivel('Platino')).not.toBe(imagenDeNivel('Plata'))
  })

  it('da una imagen distinta a cada metal', () => {
    const imagenes = ['Bronce', 'Plata', 'Oro', 'Platino'].map(imagenDeNivel)
    expect(imagenes.every(Boolean)).toBe(true)
    expect(new Set(imagenes).size).toBe(4)
  })

  it('un nivel desconocido o ausente cae a la medalla genérica, sin imagen', () => {
    expect(emojiDeNivel('Leyenda')).toBe('🏅')
    expect(imagenDeNivel('Leyenda')).toBeNull()
    expect(emojiDeNivel(null)).toBe('🏅')
    expect(imagenDeNivel(null)).toBeNull()
  })
})
