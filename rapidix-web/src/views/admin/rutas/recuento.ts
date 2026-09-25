/**
 * El recuento de lo que baja del camión, antes de mandarlo.
 *
 * Reglas puras, sin red ni componentes: son las mismas que la API impone al
 * entregar (`CANTIDAD_DE_MAS`, `FALTA_MOTIVO`, `NADA_ENTREGADO`), escritas aquí
 * para decírselas al repartidor **mientras cuenta** en vez de después de un
 * viaje de ida y vuelta. La autoridad sigue siendo el backend: esto adelanta el
 * aviso, no sustituye la validación.
 *
 * Lo que no se calcula aquí es dinero. El importe de una entrega parcial
 * depende de re-cotizar al volumen que el cliente aceptó, y eso lo hace la API:
 * la pantalla enseña lo que le devuelve.
 */
import type { MotivoDevolucion } from '@/api/tipos'

/** Un renglón del camión con lo que el repartidor lleva contado. */
export interface RenglonContado {
  pedidoItemId: string
  nombre: string
  cantidadCargada: number
  /** Lo que el cliente aceptó. Se captura esto y no lo devuelto: es lo que se cuenta. */
  cantidadEntregada: number
  motivoDevolucion: MotivoDevolucion | null
}

/** Piezas que se quedan en casa del cliente y piezas que siguen en el camión. */
export function piezasDelRecuento(renglones: RenglonContado[]): {
  entregadas: number
  devueltas: number
} {
  let entregadas = 0
  let devueltas = 0
  for (const renglon of renglones) {
    const aceptadas = Math.min(Math.max(renglon.cantidadEntregada, 0), renglon.cantidadCargada)
    entregadas += aceptadas
    devueltas += renglon.cantidadCargada - aceptadas
  }
  return { entregadas, devueltas }
}

/**
 * Lo que impide cerrar la entrega, o `null` si se puede mandar.
 *
 * El orden es el de la API: primero las cantidades imposibles, después el
 * motivo de lo que sobra y al final el pedido que no dejó nada, que no es una
 * entrega sino un intento fallido.
 */
export function problemaDelRecuento(renglones: RenglonContado[]): string | null {
  // Sin nada que contar, el pedido no va en este camión: lo movió otro
  // teléfono o ya se cerró. Es el `SIN_CARGA` de la API.
  if (renglones.length === 0) return 'Ese pedido no va en tu camión. Actualiza la pantalla.'

  for (const renglon of renglones) {
    if (!Number.isInteger(renglon.cantidadEntregada) || renglon.cantidadEntregada < 0) {
      return `Escribe cuántas piezas aceptó de «${renglon.nombre}».`
    }
    if (renglon.cantidadEntregada > renglon.cantidadCargada) {
      return (
        `De «${renglon.nombre}» subiste ${renglon.cantidadCargada} pieza(s): ` +
        'no puedes entregar más.'
      )
    }
    if (renglon.cantidadEntregada < renglon.cantidadCargada && !renglon.motivoDevolucion) {
      return `Di por qué no se quedó con todo «${renglon.nombre}».`
    }
  }

  if (piezasDelRecuento(renglones).entregadas === 0) {
    return 'Si el cliente no aceptó nada, márcalo como «No entregado».'
  }
  return null
}

/** Todo lo que la hoja de entrega sabe para decidir si ya se puede confirmar. */
export interface HojaDeEntrega {
  renglones: RenglonContado[]
  /** La foto ya está subida. */
  conFoto: boolean
  /** `false` cuando el almacenamiento de fotos no está disponible: no se puede exigir. */
  fotoExigible: boolean
  /** Lo dice la API; `null` mientras la cuenta no ha llegado. */
  cubre: boolean | null
}

/**
 * Lo que falta para confirmar, en frases cortas y en el orden en que se hace
 * en la puerta: contar, fotografiar, cobrar. Vacío es que ya se puede.
 *
 * A diferencia de `problemaDelRecuento`, junta **todo** lo pendiente: el
 * repartidor lo lee de una vez en vez de descubrirlo toque a toque.
 */
export function pendientesParaConfirmar(hoja: HojaDeEntrega): string[] {
  const pendientes: string[] = []
  const { entregadas } = piezasDelRecuento(hoja.renglones)

  if (entregadas === 0) pendientes.push('acepta al menos un producto')
  for (const renglon of hoja.renglones) {
    if (!Number.isInteger(renglon.cantidadEntregada) || renglon.cantidadEntregada < 0) {
      pendientes.push(`escribe cuántas piezas aceptó de «${renglon.nombre}»`)
    } else if (renglon.cantidadEntregada > renglon.cantidadCargada) {
      pendientes.push(`de «${renglon.nombre}» subiste ${renglon.cantidadCargada} pieza(s)`)
    } else if (
      entregadas > 0 &&
      renglon.cantidadEntregada < renglon.cantidadCargada &&
      !renglon.motivoDevolucion
    ) {
      pendientes.push(`di por qué no se quedó con todo «${renglon.nombre}»`)
    }
  }

  if (hoja.fotoExigible && !hoja.conFoto) pendientes.push('falta la foto de evidencia')
  if (hoja.cubre === null) pendientes.push('calculando el cobro')
  else if (!hoja.cubre) pendientes.push('el pago recibido no cubre el cobro')
  return pendientes
}

/**
 * Los `items` del cuerpo de la entrega.
 *
 * El motivo solo viaja con lo que sobra: mandarlo en un renglón completo es
 * `MOTIVO_DE_MAS`, y además sería un dato que después nadie sabe leer.
 */
export function itemsDeLaEntrega(
  renglones: RenglonContado[],
): { pedidoItemId: string; cantidadEntregada: number; motivoDevolucion?: MotivoDevolucion }[] {
  return renglones.map((renglon) => ({
    pedidoItemId: renglon.pedidoItemId,
    cantidadEntregada: renglon.cantidadEntregada,
    ...(renglon.cantidadEntregada < renglon.cantidadCargada && renglon.motivoDevolucion
      ? { motivoDevolucion: renglon.motivoDevolucion }
      : {}),
  }))
}
