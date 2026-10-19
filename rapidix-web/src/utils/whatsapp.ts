import { dinero, fechaNumerica, nombreMetodoPago } from '@/utils/formato'
import type { Pedido } from '@/api/tipos'

/**
 * El comprobante que se le manda al cliente por WhatsApp al entregarle su
 * pedido en la tienda.
 *
 * No se manda solo: se abre WhatsApp con el mensaje ya escrito hacia su
 * número y quien atiende pulsa enviar. Así sale del WhatsApp de la tienda,
 * que es el que el cliente conoce, y no hace falta ninguna API de mensajería.
 *
 * Aquí no se calcula nada: cada importe es el que trae el pedido.
 */

/** Lada de México: es la que se antepone a un teléfono de 10 dígitos. */
const LADA = '52'

/**
 * El teléfono como lo pide `wa.me`: solo dígitos y con lada. El login lo
 * guarda a veces con `+52` y a veces en sus 10 dígitos; `null` si no da para
 * un número marcable.
 */
export function telefonoParaWhatsApp(telefono: string | null | undefined): string | null {
  const digitos = (telefono ?? '').replace(/\D/g, '')
  if (digitos.length === 10) return LADA + digitos
  return digitos.length > 10 ? digitos : null
}

/**
 * El detalle de la compra: cliente, fecha y hora, cada producto con su
 * cantidad y su precio, y el total. Los asteriscos son las negritas de WhatsApp.
 */
export function mensajeDeEntrega(pedido: Pedido): string {
  const lineas = [
    `*Pedido ${pedido.folio}* entregado ✅`,
    ...(pedido.clienteNombre ? [`Cliente: ${pedido.clienteNombre}`] : []),
    `Fecha: ${fechaNumerica(pedido.creadoEn)}`,
    '',
    ...pedido.items.map(
      (i) => `${i.cantidad} × ${i.nombre} · ${dinero(i.precioUnitario)} c/u = ${dinero(i.importe)}`,
    ),
    '',
    `Subtotal: ${dinero(pedido.subtotal)}`,
  ]
  if (pedido.envio > 0) lineas.push(`Envío: ${dinero(pedido.envio)}`)
  if (pedido.recargoFuera > 0)
    lineas.push(`Recargo fuera de horario: ${dinero(pedido.recargoFuera)}`)
  if (pedido.redondeo > 0) lineas.push(`Redondeo del efectivo: ${dinero(pedido.redondeo)}`)
  if (pedido.descuento > 0) lineas.push(`Descuento: −${dinero(pedido.descuento)}`)
  lineas.push(`*Total: ${dinero(pedido.total)}*`)
  if (pedido.pago.billetera > 0) lineas.push(`Billetera: −${dinero(pedido.pago.billetera)}`)
  if (pedido.pago.aPagar > 0) {
    lineas.push(`Pago: ${nombreMetodoPago(pedido.pago.metodo)} ${dinero(pedido.pago.aPagar)}`)
    // Con cuánto pagó y su cambio, como en el detalle del pedido: ya vienen calculados.
    if (pedido.pago.pagoCon != null && pedido.pago.cambio != null) {
      lineas.push(`Pagó con ${dinero(pedido.pago.pagoCon)} · Cambio ${dinero(pedido.pago.cambio)}`)
    }
  }
  if (pedido.cashbackGenerado > 0) {
    lineas.push(`Ganaste ${dinero(pedido.cashbackGenerado)} de cashback`)
  }
  lineas.push('', '¡Gracias por tu compra!')
  return lineas.join('\n')
}

/** El enlace que abre WhatsApp con el comprobante escrito, o `null` sin teléfono válido. */
export function enlaceDeEntrega(pedido: Pedido, telefono?: string | null): string | null {
  const numero = telefonoParaWhatsApp(telefono ?? pedido.clienteTelefono)
  if (!numero) return null
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensajeDeEntrega(pedido))}`
}
