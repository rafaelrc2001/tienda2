import { describe, expect, it } from 'vitest'
import { enlaceDeEntrega, mensajeDeEntrega, telefonoParaWhatsApp } from './whatsapp'
import type { Pedido } from '@/api/tipos'

const pedido = {
  folio: 'ORD000112',
  clienteNombre: 'Ruben',
  clienteTelefono: '5512245678',
  creadoEn: '2026-10-08T18:34:00.000Z',
  subtotal: 44.99,
  envio: 0,
  recargoFuera: 0,
  descuento: 0,
  total: 44.99,
  cashbackGenerado: 0,
  pago: { metodo: 'EFECTIVO', billetera: 2, aPagar: 42.99 },
  items: [{ nombre: 'Chorizo Ahumado 250 gr', cantidad: 1, precioUnitario: 44.99, importe: 44.99 }],
} as unknown as Pedido

describe('telefonoParaWhatsApp', () => {
  it('antepone la lada a los 10 dígitos', () => {
    expect(telefonoParaWhatsApp('5512245678')).toBe('525512245678')
    expect(telefonoParaWhatsApp('55 1224-5678')).toBe('525512245678')
  })

  it('respeta el que ya trae lada', () => {
    expect(telefonoParaWhatsApp('+525512245678')).toBe('525512245678')
  })

  it('no inventa un número con lo que no alcanza', () => {
    expect(telefonoParaWhatsApp('12345')).toBeNull()
    expect(telefonoParaWhatsApp(null)).toBeNull()
  })
})

describe('mensajeDeEntrega', () => {
  it('lleva cliente, folio, productos con cantidad y precio, y el total', () => {
    const mensaje = mensajeDeEntrega(pedido)
    expect(mensaje).toContain('ORD000112')
    expect(mensaje).toContain('Cliente: Ruben')
    expect(mensaje).toContain('1 × Chorizo Ahumado 250 gr · $44.99 c/u = $44.99')
    expect(mensaje).toContain('*Total: $44.99*')
    expect(mensaje).toContain('Billetera: −$2.00')
    expect(mensaje).toContain('Pago: Efectivo $42.99')
  })
})

describe('enlaceDeEntrega', () => {
  it('abre el chat del cliente con el mensaje ya escrito', () => {
    const enlace = enlaceDeEntrega(pedido)
    expect(enlace).toMatch(/^https:\/\/wa\.me\/525512245678\?text=/)
    expect(decodeURIComponent(enlace!.split('text=')[1])).toBe(mensajeDeEntrega(pedido))
  })

  it('sin teléfono válido no hay enlace', () => {
    expect(enlaceDeEntrega({ ...pedido, clienteTelefono: undefined })).toBeNull()
  })
})
