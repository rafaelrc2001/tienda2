import { describe, expect, it } from 'vitest'
import { filtrarPorTexto } from './busqueda'

const FILAS = [
  { folio: 'ORD000012', cliente: 'Ana Pérez' },
  { folio: 'ORD000013', cliente: null },
]

const folios = (consulta: string) =>
  filtrarPorTexto(FILAS, consulta, (f) => [f.folio, f.cliente]).map((f) => f.folio)

describe('filtrarPorTexto', () => {
  it('vacío devuelve todo', () => {
    expect(folios('  ')).toEqual(['ORD000012', 'ORD000013'])
  })

  it('ignora acentos y mayúsculas', () => {
    expect(folios('PEREZ')).toEqual(['ORD000012'])
  })

  it('los textos vacíos no rompen ni coinciden', () => {
    expect(folios('null')).toEqual([])
    expect(folios('13')).toEqual(['ORD000013'])
  })

  it('cada palabra tiene que estar, en cualquier orden', () => {
    expect(folios('ana 12')).toEqual(['ORD000012'])
    expect(folios('ana 13')).toEqual([])
  })
})
