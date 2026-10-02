import { describe, expect, it } from 'vitest'
import {
  abonoPendiente,
  accionDelCorte,
  centavos,
  cobroDelPedido,
  conteoCompleto,
  diferenciasDelConteo,
  errorDelAbono,
  errorDelDeclarado,
  esperaDelCorte,
  estadoEnHistorial,
  faltanteDe,
  lineaDelArqueo,
  limitarDevuelto,
  lineaDeProductos,
  montoCapturado,
  piezasCapturadas,
  porcentajeDeExito,
} from './liquidacion'
import type {
  AbonoDelCorte,
  ConteoDeProducto,
  Corte,
  EntregaEnHistorial,
  PedidoDelCorte,
} from '@/api/tipos'

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
  devolucionAceptadaEn: null,
  devolucionAceptadaPorNombre: null,
  entregaAceptadaEn: null,
  entregaAceptadaPorNombre: null,
  dineroPorAceptar: 100,
  estado: 'LIQUIDADO',
  notas: null,
  entrega: { id: 'e1', folio: 'REP000001', numero: 1, nombre: null },
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
    folio: 'REP000001',
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
    expect(estadoEnHistorial(entrega({ corte: corte({ estado: 'ACEPTADO' }) }))).toBe('Aceptado')
    expect(estadoEnHistorial(entrega({ corte: corte({ estado: 'CERRADO' }) }))).toBe('Cerrado')
  })

  // El corte en cada punto de su camino por Finanzas.
  const AHORA = '2026-09-28T21:00:00Z'
  const abono = (cambios: Partial<AbonoDelCorte> = {}): AbonoDelCorte => ({
    id: 'a1',
    monto: 20,
    registradoPorNombre: 'Ana',
    nota: null,
    creadoEn: AHORA,
    aceptadoEn: null,
    ...cambios,
  })
  const conDevolucion = { devolucionAceptadaEn: AHORA, devolucionAceptadaPorNombre: 'Fin' }
  const conDinero = {
    ...conDevolucion,
    recibidoEn: AHORA,
    recibidoPorNombre: 'Fin',
    montoRecibido: 80,
    dineroPorAceptar: null,
  }
  const aceptado = {
    ...conDinero,
    entregaAceptadaEn: AHORA,
    entregaAceptadaPorNombre: 'Fin',
    estado: 'ACEPTADO' as const,
    saldoPendiente: 20,
  }

  it('Finanzas acepta en orden: devolución, dinero, entrega y después los abonos', () => {
    expect(esperaDelCorte(corte())).toBe('devolucion')
    expect(esperaDelCorte(corte(conDevolucion))).toBe('dinero')
    expect(esperaDelCorte(corte(conDinero))).toBe('entrega')
    expect(esperaDelCorte(corte(aceptado))).toBeNull()
    expect(esperaDelCorte(corte({ ...aceptado, estado: 'LIQUIDADO', abonos: [abono()] }))).toBe(
      'abono',
    )
    expect(esperaDelCorte(corte({ ...aceptado, estado: 'CERRADO', saldoPendiente: 0 }))).toBeNull()
  })

  it('se corrige mientras el dinero no esté aceptado, aunque ya bajara la devolución', () => {
    expect(accionDelCorte(null)).toBeNull()
    expect(accionDelCorte(corte())).toBe('corregir')
    expect(accionDelCorte(corte(conDevolucion))).toBe('corregir')
  })

  it('con el dinero aceptado y la entrega sin aceptar no hay botón', () => {
    expect(accionDelCorte(corte(conDinero))).toBeNull()
  })

  it('entrega más dinero solo si debe y ya le aceptaron la entrega', () => {
    expect(accionDelCorte(corte(aceptado))).toBe('completar')
    expect(accionDelCorte(corte({ ...aceptado, saldoPendiente: 0 }))).toBeNull()
  })

  it('con un abono esperando solo puede cancelarlo, no hacer otro', () => {
    const esperando = corte({ ...aceptado, estado: 'LIQUIDADO', abonos: [abono()] })
    expect(abonoPendiente(esperando)?.id).toBe('a1')
    expect(accionDelCorte(esperando)).toBe('cancelar')
    // El abono sin aceptar no baja el adeudo.
    expect(faltanteDe(esperando)).toBe(20)
  })

  it('un abono ya aceptado no está pendiente', () => {
    const abonado = corte({ ...aceptado, abonos: [abono({ aceptadoEn: AHORA })] })
    expect(abonoPendiente(abonado)).toBeNull()
    expect(accionDelCorte(abonado)).toBe('completar')
  })

  it('un corte cerrado no tiene botón', () => {
    expect(accionDelCorte(corte({ ...aceptado, estado: 'CERRADO', saldoPendiente: 0 }))).toBeNull()
  })

  it('un adeudo de 0.004 está saldado', () => {
    expect(faltanteDe(corte({ ...aceptado, saldoPendiente: 0.004 }))).toBe(0)
    expect(accionDelCorte(corte({ ...aceptado, saldoPendiente: 0.004 }))).toBeNull()
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
