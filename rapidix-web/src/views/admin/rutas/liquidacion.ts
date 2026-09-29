/**
 * Las reglas que la pantalla de Rutas le escribe al repartidor sobre su
 * dinero: la línea del arqueo, el estado de cada entrega en el historial y la
 * validación de lo que captura.
 *
 * No suman importes —eso lo hace la API—: comparan dos cifras que ya vienen
 * hechas y deciden qué decir. Aparte para probarlas, porque un texto
 * equivocado aquí hace que el repartidor crea que le falta dinero que sí trae.
 */
import { dinero } from '@/utils/formato'
import type { Corte, EntregaEnHistorial, PedidoDelCorte, ResultadoDelIntento } from '@/api/tipos'

/** Por debajo de medio centavo dos montos son el mismo. */
export const TOLERANCIA = 0.005

/** Redondea a centavos y convierte en cero lo que cae dentro de la tolerancia. */
export function centavos(monto: number): number {
  const redondeado = Math.round(monto * 100) / 100
  return Math.abs(redondeado) <= TOLERANCIA ? 0 : redondeado
}

/** Lo que el campo trae como número, o `null` si está vacío o no es un monto. */
export function montoCapturado(valor: number | string | null | undefined): number | null {
  if (valor === '' || valor === null || valor === undefined) return null
  const numero = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'))
  return Number.isFinite(numero) ? numero : null
}

export type Tono = 'base' | 'ok' | 'alerta'

/**
 * La línea del arqueo, que cambia con cada tecla.
 *
 * Que no cuadre **no bloquea**: solo el campo vacío impide cerrar. Por eso el
 * faltante y el sobrante dicen lo mismo —que se puede cerrar y queda escrito—.
 */
export function lineaDelArqueo(
  calculado: number,
  capturado: number | null,
): {
  texto: string
  tono: Tono
} {
  if (capturado === null)
    return { texto: 'Captura cuánto entregas para poder cerrar.', tono: 'base' }
  const diferencia = centavos(capturado - calculado)
  if (diferencia === 0) return { texto: '✓ Cuadra con lo calculado.', tono: 'ok' }
  const cuanto = dinero(Math.abs(diferencia))
  return {
    texto: `${diferencia < 0 ? 'Faltan' : 'Sobran'} ${cuanto}. Puedes cerrar igual: la diferencia queda registrada.`,
    tono: 'alerta',
  }
}

/** `10× Pimienta, 8× Cebolla`: la línea de productos de un pedido del corte. */
export function lineaDeProductos(pedido: PedidoDelCorte): string {
  return pedido.productos.map((p) => `${p.cantidad}× ${p.nombre}`).join(', ')
}

/** El porcentaje de éxito del encabezado. Cero, y no `NaN`, sin pedidos. */
export function porcentajeDeExito(entregados: number, total: number): number {
  return total > 0 ? Math.round((entregados / total) * 100) : 0
}

/**
 * Lo que va a la derecha de un pedido de Liquidación: exactamente una cosa.
 * «Pagado en línea» en lugar de un `$0.00` seco, que parece un error.
 */
export function cobroDelPedido(
  pedido: PedidoDelCorte,
): 'devolucion' | 'en-linea' | 'credito' | 'efectivo' {
  if (pedido.devolucion) return 'devolucion'
  if (pedido.metodoPago !== 'EFECTIVO' || pedido.estadoPago === 'PAGADO') return 'en-linea'
  if (pedido.estadoPago === 'CREDITO') return 'credito'
  return 'efectivo'
}

// ------------------------------------------------------------------
// Historial
// ------------------------------------------------------------------

/** El estado de una entrega en el historial. */
export function estadoEnHistorial(entrega: EntregaEnHistorial): string {
  const { corte } = entrega
  if (corte) {
    return corte.estado === 'RECIBIDO'
      ? 'Liquidada · corte recibido'
      : 'Liquidada · corte pendiente de recibir'
  }
  if (entrega.finalizadaEn) return 'Terminada, sin liquidar'
  return entrega.iniciadaEn ? 'En curso' : 'Sin iniciar'
}

/** Lo que falta por entregar de un corte, ya con la tolerancia. */
export function faltanteDe(corte: Corte): number {
  return Math.max(0, centavos(corte.saldoPendiente))
}

/**
 * El botón de dinero que toca, como mucho uno. Antes de que Finanzas cuente se
 * **corrige** lo declarado; después ya no se toca y lo que falte se **abona**.
 */
export function accionDelCorte(corte: Corte | null): 'corregir' | 'completar' | null {
  if (!corte) return null
  if (corte.estado === 'CERRADO') return 'corregir'
  return faltanteDe(corte) > 0 ? 'completar' : null
}

/** La validación de «Corregir lo que declaré»: un número finito, cero o más. */
export function errorDelDeclarado(valor: number | string | null | undefined): string {
  const monto = montoCapturado(valor)
  if (monto === null) return 'Escribe cuánto entregas, aunque sea cero.'
  if (monto < 0) return 'El monto no puede ser negativo.'
  return ''
}

/**
 * La validación de «Completar el faltante»: más de cero y no más de lo que
 * falta. La API lo vuelve a comprobar; esto solo ahorra el viaje.
 */
export function errorDelAbono(valor: number | string | null | undefined, faltante: number): string {
  const monto = montoCapturado(valor)
  if (monto === null) return 'Escribe cuánto entregas.'
  if (monto <= 0) return 'El abono tiene que ser mayor que cero.'
  if (centavos(monto - faltante) > 0) return `No puede pasar de lo que falta: ${dinero(faltante)}.`
  return ''
}

const NOMBRE_RESULTADO: Record<ResultadoDelIntento, string> = {
  ENTREGADO: 'Entregado',
  PARCIAL: 'Parcial',
  EN_CAMION: 'En el camión',
  EN_RUTA: 'En ruta',
  DEVUELTO: 'Devuelto',
  CANCELADO: 'Cancelado',
}

export function nombreResultado(resultado: ResultadoDelIntento): string {
  return NOMBRE_RESULTADO[resultado] ?? resultado
}
