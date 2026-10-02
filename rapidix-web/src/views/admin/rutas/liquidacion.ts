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
import type {
  AbonoDelCorte,
  ConteoDeProducto,
  Corte,
  EntregaEnHistorial,
  EstadoCorte,
  PedidoDelCorte,
  ResultadoDelIntento,
} from '@/api/tipos'

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
// Lo que baja del camión
// ------------------------------------------------------------------

/** Lo que el campo «Devuelto» trae como piezas enteras, o `null` si está vacío o no vale. */
export function piezasCapturadas(valor: string | null | undefined): number | null {
  const texto = (valor ?? '').trim()
  return /^\d+$/.test(texto) ? Number(texto) : null
}

/**
 * Lo que se deja escribir en «Devuelto»: solo dígitos y nunca más de lo que
 * regresa. Traer de más no es algo que haya que cobrar ni registrar, así que
 * se topa en la devolución en vez de avisar. Vacío sigue siendo «sin contar».
 */
export function limitarDevuelto(valor: string, devolucion: number): string {
  const digitos = valor.replace(/\D/g, '')
  if (digitos === '') return ''
  return String(Math.min(Number(digitos), devolucion))
}

/** Un producto cuyo conteo no cuadra con lo que el sistema dice que regresa. */
export interface DiferenciaDeConteo {
  productoId: string
  nombre: string
  unidad: string
  /** Positivo: bajó de menos (faltante). Negativo: bajó de más. */
  faltan: number
}

/**
 * Lo que el repartidor contó contra la devolución del sistema, producto por
 * producto. El campo vacío no es diferencia: no se ha contado todavía.
 */
export function diferenciasDelConteo(
  conteo: ConteoDeProducto[],
  contados: Record<string, string>,
): DiferenciaDeConteo[] {
  return conteo.flatMap((p) => {
    const contado = piezasCapturadas(contados[p.productoId])
    if (contado === null || contado === p.devolucion) return []
    return [
      {
        productoId: p.productoId,
        nombre: p.nombre,
        unidad: p.unidad,
        faltan: p.devolucion - contado,
      },
    ]
  })
}

/**
 * Si ya se puede finalizar la liquidación: cada producto que regresa tiene
 * «Devuelto» capturado y es justo su devolución.
 *
 * Vacío no vale —no se ha contado— y contar de menos tampoco: ese faltante se
 * cobra antes con su pedido, que baja la devolución a lo contado y entonces
 * cuadra. Lo que no regresa no hay que contarlo. La API lo vuelve a comprobar
 * (`CONTEO_NO_CUADRA`); esto apaga el botón y ahorra el viaje.
 */
export function conteoCompleto(
  conteo: ConteoDeProducto[],
  contados: Record<string, string>,
): boolean {
  return conteo.every(
    (p) => p.devolucion <= 0 || piezasCapturadas(contados[p.productoId]) === p.devolucion,
  )
}

// ------------------------------------------------------------------
// Historial
// ------------------------------------------------------------------

const NOMBRE_ESTADO_CORTE: Record<EstadoCorte, string> = {
  LIQUIDADO: 'Liquidado',
  ACEPTADO: 'Aceptado',
  CERRADO: 'Cerrado',
}

/** El estatus del corte, con el nombre que lleva en Rutas y en Finanzas. */
export function nombreEstadoCorte(estado: EstadoCorte): string {
  return NOMBRE_ESTADO_CORTE[estado] ?? estado
}

/**
 * El estatus de una entrega en el historial. Con corte es el del corte, tal
 * cual: lo decide la API y aquí solo se le pone nombre.
 */
export function estadoEnHistorial(entrega: EntregaEnHistorial): string {
  const { corte } = entrega
  if (corte) return nombreEstadoCorte(corte.estado)
  if (entrega.finalizadaEn) return 'Terminada, sin liquidar'
  return entrega.iniciadaEn ? 'En curso' : 'Sin iniciar'
}

/**
 * El adeudo del repartidor, ya con la tolerancia. Un abono que Finanzas no ha
 * aceptado todavía **no** lo baja: ese dinero sigue siendo del repartidor.
 */
export function faltanteDe(corte: Corte): number {
  return Math.max(0, centavos(corte.saldoPendiente))
}

/** El abono que espera a Finanzas. Hay uno a la vez, como mucho. */
export function abonoPendiente(corte: Corte): AbonoDelCorte | null {
  return corte.abonos.find((abono) => abono.aceptadoEn === null) ?? null
}

/** Lo que el corte espera de Finanzas, en el orden en que se acepta. */
export type EsperaDelCorte = 'devolucion' | 'dinero' | 'entrega' | 'abono'

/**
 * Qué le toca aceptar a Finanzas ahora, o `null` si no espera nada: está
 * cerrado, o le toca al repartidor traer lo que debe.
 *
 * Primero la devolución, luego el dinero, luego la entrega; después de eso lo
 * único que puede esperar es un abono.
 */
export function esperaDelCorte(corte: Corte): EsperaDelCorte | null {
  if (corte.estado === 'CERRADO') return null
  if (corte.devolucionAceptadaEn === null) return 'devolucion'
  if (corte.recibidoEn === null) return 'dinero'
  if (corte.entregaAceptadaEn === null) return 'entrega'
  return abonoPendiente(corte) ? 'abono' : null
}

/**
 * El botón de dinero que le toca al repartidor, como mucho uno:
 *
 *  - **corregir** lo declarado, mientras Finanzas no acepte ese dinero;
 *  - **completar**: entregar más dinero contra su adeudo, ya con la entrega
 *    aceptada;
 *  - **cancelar** el abono que hizo y Finanzas todavía no acepta.
 *
 * Entre que se acepta el dinero y se acepta la entrega no hay botón: lo que
 * deba, si debe, se sabe hasta que Finanzas la da por aceptada.
 */
export function accionDelCorte(corte: Corte | null): 'corregir' | 'completar' | 'cancelar' | null {
  if (!corte || corte.estado === 'CERRADO') return null
  if (corte.recibidoEn === null) return 'corregir'
  if (abonoPendiente(corte)) return 'cancelar'
  if (corte.entregaAceptadaEn === null) return null
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
 * La validación de «Entregar dinero»: más de cero y no más de lo que se debe.
 * La API lo vuelve a comprobar; esto solo ahorra el viaje.
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
