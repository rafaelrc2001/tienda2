import { describe, expect, it } from 'vitest'
import { horarioPorDefecto, resumenHorario } from './horario'

describe('resumenHorario', () => {
  it('junta los días seguidos con las mismas horas', () => {
    const horario = horarioPorDefecto()
    horario.sab = { abre: '09:00', cierra: '14:00' }
    expect(resumenHorario(horario)).toBe('Lun a Vie 09:00–18:00 · Sáb 09:00–14:00 · Dom cerrado')
  })

  it('un día suelto va sin rango', () => {
    const horario = horarioPorDefecto()
    horario.mie = null
    horario.dom = { abre: '09:00', cierra: '18:00' }
    expect(resumenHorario(horario)).toBe(
      'Lun a Mar 09:00–18:00 · Mié cerrado · Jue a Dom 09:00–18:00',
    )
  })
})
