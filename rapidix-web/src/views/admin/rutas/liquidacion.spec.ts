import { describe, expect, it } from 'vitest'
import {
  accionDelCorte,
  centavos,
  cobroDelPedido,
  conteoCompleto,
  diferenciasDelConteo,
  errorDelAbono,
  errorDelDeclarado,
  estadoEnHistorial,
  faltanteDe,
  lineaDelArqueo,
  limitarDevuelto,
  lineaDeProductos,
  montoCapturado,
  piezasCapturadas,
  porcentajeDeExito,
} from './liquidacion'
import type { ConteoDeProducto, Corte, EntregaEnHistorial, PedidoDelCorte } from '@/api/tipos'

const corte = (cambios: Partial<Corte> = {}): Corte => ({
  id: 'c1',
  repartidorId: 'r1',
  repartidorNombre: 'Ana',
  cerradoEn: '2026-09-28T20:00:00Z',
  montoCalculado: 100,
  montoDeclarado: 100,
  montoRecibido: null,
  diferencia: 0,
  saldoPendiente: 0,
  recibidoEn: null,
  recibidoPorNombre: null,
  estado: 'CERRADO',
  notas: null,
  entrega: { numero: 1, nombre: null },
  abonos: [],
  pedidos: 3,
  ...cambios,
})

const pedido = (cambios: Partial<PedidoDelCorte> = {}): PedidoDelCorte => ({
  id: 'p1',
  folio: 'RPX-1',
  clienteNombre: 'Luis',
  estado: 'ENTREGADO',
  estadoPago: 'PAGO_PENDIENTE',
  metodoPago: 'EFECTIVO',
  devolucion: false,
  porFaltante: false,
  efectivo: 50,
  devueltas: 0,
  productos: [
    { nombre: 'Pimienta', unidad: 'pza', cantidad: 10 },
    { nombre: 'Cebolla', unidad: 'kg', cantidad: 8 },
  ],
  ...cambios,
})

describe('lineaDelArqueo', () => {
  it('vacío pide capturar', () => {
    expect(lineaDelArqueo(100, null).tono).toBe('base')
  })

  it('cuadra dentro de medio centavo', () => {
    expect(lineaDelArqueo(100, 100.004)).toEqual({
      texto: '✓ Cuadra con lo calculado.',
      tono: 'ok',
    })
  })

  it('faltante y sobrante dejan cerrar igual', () => {
    const falta = lineaDelArqueo(100, 90)
    expect(falta.tono).toBe('alerta')
    expect(falta.texto).toMatch(/^Faltan \$10\.00\. Puedes cerrar igual/)
    expect(lineaDelArqueo(100, 100.5).texto).toMatch(/^Sobran \$0\.50/)
  })
})

describe('montoCapturado', () => {
  it('vacío es null, cero es cero', () => {
    expect(montoCapturado('')).toBeNull()
    expect(montoCapturado(0)).toBe(0)
    expect(montoCapturado('12,5')).toBe(12.5)
    expect(montoCapturado('abc')).toBeNull()
  })
})

describe('encabezado y liquidación', () => {
  it('sin pedidos el éxito es 0, no NaN', () => {
    expect(porcentajeDeExito(0, 0)).toBe(0)
    expect(porcentajeDeExito(6, 12)).toBe(50)
  })

  it('la línea de productos va en un renglón', () => {
    expect(lineaDeProductos(pedido())).toBe('10× Pimienta, 8× Cebolla')
  })

  it('a la derecha va una sola cosa', () => {
    expect(cobroDelPedido(pedido())).toBe('efectivo')
    expect(cobroDelPedido(pedido({ devolucion: true, estadoPago: 'CANCELADO' }))).toBe('devolucion')
    expect(cobroDelPedido(pedido({ metodoPago: 'TRANSFERENCIA' }))).toBe('en-linea')
    expect(cobroDelPedido(pedido({ estadoPago: 'PAGADO' }))).toBe('en-linea')
    expect(cobroDelPedido(pedido({ estadoPago: 'CREDITO' }))).toBe('credito')
  })
})

describe('historial', () => {
  const entrega = (cambios: Partial<EntregaEnHistorial> = {}): EntregaEnHistorial => ({
    id: 'e1',
    numero: 1,
    nombre: null,
    creadoEn: '2026-09-28T09:00:00Z',
    iniciadaEn: '2026-09-28T09:10:00Z',
    finalizadaEn: null,
    pedidos: 3,
    corte: null,
    ...cambios,
  })

  it('dice en qué va cada entrega', () => {
    expect(estadoEnHistorial(entrega({ iniciadaEn: null }))).toBe('Sin iniciar')
    expect(estadoEnHistorial(entrega())).toBe('En curso')
    expect(estadoEnHistorial(entrega({ finalizadaEn: '2026-09-28T15:00:00Z' }))).toBe(
      'Terminada, sin liquidar',
    )
    expect(estadoEnHistorial(entrega({ corte: corte() }))).toBe('Liquidado')
    expect(estadoEnHistorial(entrega({ corte: corte({ estado: 'RECIBIDO' }) }))).toMatch(/recibido/)
  })

  it('corregir solo antes de recibir; completar solo recibido con saldo; nunca los dos', () => {
    expect(accionDelCorte(null)).toBeNull()
    expect(accionDelCorte(corte())).toBe('corregir')
    expect(accionDelCorte(corte({ estado: 'RECIBIDO', saldoPendiente: 20 }))).toBe('completar')
    expect(accionDelCorte(corte({ estado: 'RECIBIDO', saldoPendiente: 0 }))).toBeNull()
  })

  it('un faltante de 0.004 está saldado', () => {
    expect(faltanteDe(corte({ estado: 'RECIBIDO', saldoPendiente: 0.004 }))).toBe(0)
    expect(accionDelCorte(corte({ estado: 'RECIBIDO', saldoPendiente: 0.004 }))).toBeNull()
  })

  it('valida lo declarado y el abono', () => {
    expect(errorDelDeclarado('')).not.toBe('')
    expect(errorDelDeclarado(0)).toBe('')
    expect(errorDelDeclarado(-1)).not.toBe('')
    expect(errorDelAbono(0, 20)).not.toBe('')
    expect(errorDelAbono(20, 20)).toBe('')
    expect(errorDelAbono(20.01, 20)).toMatch(/No puede pasar/)
  })

  it('centavos redondea sin colas', () => {
    expect(centavos(0.1 + 0.2 - 0.3)).toBe(0)
    expect(centavos(-10.004)).toBe(-10)
  })
})

describe('conteo de lo que baja del camión', () => {
  const producto = (productoId: string, devolucion: number): ConteoDeProducto => ({
    productoId,
    nombre: productoId,
    unidad: 'pza',
    cargado: 8,
    entregado: 8 - devolucion,
    devolucion,
  })

  it('solo acepta piezas enteras', () => {
    expect(piezasCapturadas(' 3 ')).toBe(3)
    expect(piezasCapturadas('')).toBeNull()
    expect(piezasCapturadas('1.5')).toBeNull()
    expect(piezasCapturadas('-1')).toBeNull()
  })

  it('el campo vacío no es diferencia; contar de menos es faltante y de más, negativo', () => {
    const conteo = [producto('queso', 4), producto('pan', 2), producto('caldo', 0)]
    expect(diferenciasDelConteo(conteo, { queso: '2', pan: '', caldo: '1' })).toEqual([
      { productoId: 'queso', nombre: 'queso', unidad: 'pza', faltan: 2 },
      { productoId: 'caldo', nombre: 'caldo', unidad: 'pza', faltan: -1 },
    ])
  })

  it('«Devuelto» solo acepta dígitos y se topa en la devolución', () => {
    expect(limitarDevuelto('3', 4)).toBe('3')
    expect(limitarDevuelto('9', 4)).toBe('4')
    expect(limitarDevuelto('1a.5', 20)).toBe('15')
    expect(limitarDevuelto('-', 4)).toBe('')
    expect(limitarDevuelto('007', 4)).toBe('4')
    expect(limitarDevuelto('02', 4)).toBe('2')
  })

  it('lo que cuadra no aparece', () => {
    expect(diferenciasDelConteo([producto('queso', 4)], { queso: '4' })).toEqual([])
  })

  it('el conteo está completo cuando cada producto que regresa se contó entero', () => {
    const conteo = [producto('queso', 4), producto('pan', 2)]
    expect(conteoCompleto(conteo, { queso: '4', pan: '2' })).toBe(true)
  })

  it('un producto sin contar deja el conteo incompleto', () => {
    const conteo = [producto('queso', 4), producto('pan', 2)]
    expect(conteoCompleto(conteo, { queso: '4', pan: '' })).toBe(false)
    expect(conteoCompleto(conteo, { queso: '4' })).toBe(false)
  })

  it('contar de menos lo deja incompleto: el faltante se cobra antes', () => {
    expect(conteoCompleto([producto('queso', 4)], { queso: '3' })).toBe(false)
    // Ya con su pedido por faltante, la devolución bajó a lo contado.
    expect(conteoCompleto([producto('queso', 3)], { queso: '3' })).toBe(true)
  })

  it('contar cero vale solo si no regresa nada de ese producto', () => {
    expect(conteoCompleto([producto('queso', 4)], { queso: '0' })).toBe(false)
  })

  it('lo que no regresa no hay que contarlo, y sin nada que regrese está completo', () => {
    expect(conteoCompleto([producto('caldo', 0)], {})).toBe(true)
    expect(conteoCompleto([], {})).toBe(true)
  })
})
