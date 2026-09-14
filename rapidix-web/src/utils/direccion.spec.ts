import { describe, expect, it } from 'vitest'
import type { Perfil } from '@/api/tipos'
import {
  direccionCompleta,
  direccionInicial,
  direccionVacia,
  erroresDireccion,
  faltantesDireccion,
  perfilTieneDireccion,
  resumenDireccion,
  soloDigitos,
} from './direccion'

function perfil(sobre: Partial<Perfil> = {}): Perfil {
  return {
    id: 'c1',
    nombre: 'Rubén Pérez',
    email: null,
    telefono: '+52 993 123 4567',
    fechaNacimiento: null,
    quienRecibe: null,
    sucursal: null,
    direccion: {
      calle: 'Reforma 12',
      colonia: 'Centro',
      cp: '86000',
      ciudad: 'Villahermosa',
      estado: 'Tabasco',
      referencias: null,
      lat: 17.9,
      lng: -92.9,
    },
    notificaciones: true,
    pedidos: 0,
    totalGastado: 0,
    primerPedido: null,
    ultimoPedido: null,
    creado: '2026-01-01T00:00:00.000Z',
    ...sobre,
  }
}

const valida = {
  ...direccionVacia(),
  quienRecibe: 'Ana',
  telefono: '9931234567',
  calle: 'Reforma 12',
  colonia: 'Centro',
  cp: '86000',
  ciudad: 'Villahermosa',
}

describe('direccionInicial', () => {
  it('manda el borrador del pedido sobre el perfil', () => {
    const borrador = { ...valida, calle: 'Casa de mi mamá 5' }
    expect(direccionInicial(borrador, perfil()).calle).toBe('Casa de mi mamá 5')
  })

  it('sin borrador parte del perfil, con coordenadas y teléfono de 10 dígitos', () => {
    const d = direccionInicial(null, perfil())
    expect(d).toMatchObject({ calle: 'Reforma 12', cp: '86000', lat: 17.9, lng: -92.9 })
    expect(d.telefono).toBe('9931234567')
    expect(d.referencias).toBe('')
  })

  it('si el perfil no dice quién recibe, recibe el usuario', () => {
    expect(direccionInicial(null, perfil()).quienRecibe).toBe('Rubén Pérez')
    expect(direccionInicial(null, perfil({ quienRecibe: 'Lupita' })).quienRecibe).toBe('Lupita')
  })

  it('sin borrador ni perfil, vacía', () => {
    expect(direccionInicial(null, null)).toEqual(direccionVacia())
  })
})

describe('validación y resumen', () => {
  it('una dirección completa no tiene errores', () => {
    expect(erroresDireccion(valida)).toEqual({})
  })

  it('exige CP de 5 dígitos y teléfono de 10', () => {
    const errores = erroresDireccion({ ...valida, cp: '8600', telefono: '99312' })
    expect(Object.keys(errores)).toEqual(['telefono', 'cp'])
  })

  it('estado y referencias son opcionales', () => {
    expect(erroresDireccion({ ...valida, estado: '', referencias: '' })).toEqual({})
  })

  it('lista lo que falta con nombres legibles', () => {
    expect(faltantesDireccion(direccionVacia())).toEqual([
      'quién recibe',
      'teléfono',
      'calle',
      'colonia',
      'código postal',
      'ciudad',
    ])
  })

  it('resume quién recibe, calle y ciudad saltando lo vacío', () => {
    expect(resumenDireccion(valida)).toBe('Ana · Reforma 12 · Villahermosa')
    expect(resumenDireccion({ ...valida, quienRecibe: ' ' })).toBe('Reforma 12 · Villahermosa')
    expect(resumenDireccion(direccionVacia())).toBe('')
  })

  it('está completa para cerrar el bloque con calle y ciudad', () => {
    expect(direccionCompleta(valida)).toBe(true)
    expect(direccionCompleta({ ...valida, ciudad: '' })).toBe(false)
  })

  it('el perfil tiene dirección si tiene calle', () => {
    expect(perfilTieneDireccion(perfil())).toBe(true)
    expect(perfilTieneDireccion(null)).toBe(false)
    const sinCalle = perfil()
    sinCalle.direccion.calle = null
    expect(perfilTieneDireccion(sinCalle)).toBe(false)
  })

  it('soloDigitos limpia y topa', () => {
    expect(soloDigitos('86-000-1', 5)).toBe('86000')
  })
})
