import { describe, expect, it } from 'vitest'
import { buscarPedidos, normalizar } from './busqueda'
import type { PedidoEnFinanzas } from '@/api/tipos'

/** Solo lo que la búsqueda lee; lo demás del pedido no importa aquí. */
const pedido = (
  folio: string,
  clienteNombre: string | null,
  estado: string,
  estadoPago: string,
): PedidoEnFinanzas =>
  ({ folio, clienteNombre, estado, pago: { estado: estadoPago } }) as unknown as PedidoEnFinanzas

const PEDIDOS = [
  pedido('ORD000098', 'Venta en ruta', 'ENTREGADO', 'PAGO_PENDIENTE'),
  pedido('ORD000097', 'Cliente de prueba', 'ENTREGADO', 'CREDITO'),
  pedido('ORD000090', 'Cliente de prueba', 'RECOLECTADO', 'PAGADO'),
  pedido('ORD000064', null, 'EN_RUTA', 'CANCELADO'),
]

const folios = (consulta: string) => buscarPedidos(PEDIDOS, consulta).map((p) => p.folio)

describe('normalizar', () => {
  it('quita acentos, mayúsculas y espacios de los lados', () => {
    expect(normalizar('  Crédito ')).toBe('credito')
  })
})

describe('buscarPedidos', () => {
  it('vacío devuelve todos', () => {
    expect(folios('')).toHaveLength(4)
    expect(folios('   ')).toHaveLength(4)
  })

  it('encuentra por folio, aunque sea un trozo', () => {
    expect(folios('ord000098')).toEqual(['ORD000098'])
    expect(folios('97')).toEqual(['ORD000097'])
  })

  it('encuentra por cliente', () => {
    expect(folios('prueba')).toEqual(['ORD000097', 'ORD000090'])
  })

  it('encuentra por el estado del pedido como se lee en pantalla', () => {
    expect(folios('en ruta')).toEqual(['ORD000098', 'ORD000064'])
    expect(folios('recolectado')).toEqual(['ORD000090'])
  })

  it('encuentra por el estatus de pago, sin acentos', () => {
    expect(folios('pendiente')).toEqual(['ORD000098'])
    expect(folios('credito')).toEqual(['ORD000097'])
  })

  it('con varias palabras tienen que estar todas', () => {
    expect(folios('prueba pagado')).toEqual(['ORD000090'])
  })

  it('sin coincidencias devuelve vacío', () => {
    expect(folios('zzz')).toEqual([])
  })
})
