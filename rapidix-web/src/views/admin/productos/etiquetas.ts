/**
 * Los enums de bodega, escritos como los lee un encargado.
 *
 * Viven aquí y no en cada ventana porque Movimientos los usa para capturar y
 * el historial para leer: si divergieran, el mismo movimiento se llamaría de
 * dos maneras en la misma pantalla.
 */
import type { AfectaInventario, MotivoMovimiento, RolProducto, TipoMovimiento } from '@/api/tipos'

/**
 * El papel del producto dentro de su familia, en el orden en que desempata la
 * Tienda: Destino primero, Conveniencia al final.
 *
 * La ayuda no es decorativa: quien da de alta un producto tiene que poder
 * elegir sin haber leído la historia de usuario.
 */
export const ROLES: { valor: RolProducto; etiqueta: string; ayuda: string }[] = [
  { valor: 'DESTINO', etiqueta: 'Destino', ayuda: 'Por lo que el cliente viene a la tienda' },
  { valor: 'RUTINA', etiqueta: 'Rutina', ayuda: 'Lo que repone cada semana' },
  { valor: 'ESTACIONAL', etiqueta: 'Estacional', ayuda: 'Solo tiene sentido parte del año' },
  { valor: 'CONVENIENCIA', etiqueta: 'Conveniencia', ayuda: 'Lo que añade sobre la marcha' },
]

const NOMBRE_ROL: Record<RolProducto, string> = {
  DESTINO: 'Destino',
  RUTINA: 'Rutina',
  ESTACIONAL: 'Estacional',
  CONVENIENCIA: 'Conveniencia',
}

export function nombreRol(rol: RolProducto): string {
  return NOMBRE_ROL[rol]
}

export const TIPOS: { valor: TipoMovimiento; etiqueta: string }[] = [
  { valor: 'ENTRADA', etiqueta: 'Entrada' },
  { valor: 'SALIDA', etiqueta: 'Salida' },
]

export const AFECTA: { valor: AfectaInventario; etiqueta: string; ayuda: string }[] = [
  { valor: 'AMBOS', etiqueta: 'Ambos (físico y apt.)', ayuda: 'La mercancía entra o sale de verdad' },
  { valor: 'FISICO', etiqueta: 'Solo físico', ayuda: 'Llegó a bodega pero no se libera a venta' },
  { valor: 'APT', etiqueta: 'Solo apt. venta', ayuda: 'Aparta o libera lo que ya está en piso' },
]

/**
 * Motivos que se capturan a mano. `VENTA` no está: esa salida la escribe el
 * pedido al confirmarse, y ofrecerla aquí sería invitar a descontar dos veces
 * la misma venta.
 */
export const MOTIVOS_CAPTURA: { valor: MotivoMovimiento; etiqueta: string }[] = [
  { valor: 'COMPRA', etiqueta: 'Compra' },
  { valor: 'MERMA', etiqueta: 'Merma' },
  { valor: 'TRASPASO', etiqueta: 'Traspaso' },
  { valor: 'AJUSTE', etiqueta: 'Ajuste' },
  { valor: 'DEVOLUCION', etiqueta: 'Devolución' },
]

const NOMBRE_MOTIVO: Record<MotivoMovimiento, string> = {
  COMPRA: 'Compra',
  VENTA: 'Venta',
  MERMA: 'Merma',
  TRASPASO: 'Traspaso',
  AJUSTE: 'Ajuste',
  DEVOLUCION: 'Devolución',
}

const NOMBRE_AFECTA: Record<AfectaInventario, string> = {
  AMBOS: 'Ambos',
  FISICO: 'Solo físico',
  APT: 'Solo apt.',
}

export function nombreMotivo(motivo: MotivoMovimiento): string {
  return NOMBRE_MOTIVO[motivo]
}

export function nombreAfecta(afecta: AfectaInventario): string {
  return NOMBRE_AFECTA[afecta]
}

/**
 * Por debajo de esto el saldo de venta se pinta en ámbar.
 *
 * Es un número fijo a propósito: un umbral por producto sería otra columna que
 * mantener, y para avisar de que algo se está acabando basta con un aviso
 * visual que el encargado interpreta con lo que sabe del producto.
 */
export const UMBRAL_BAJO = 5

/**
 * Teclas que `type="number"` deja escribir y que no son un número.
 *
 * El input las acepta y luego reporta el valor como vacío, así que el usuario
 * ve algo escrito y el formulario cree que no hay nada.
 */
export function soloNumeros(evento: KeyboardEvent): void {
  if (['e', 'E', '+', '-', ',', '.'].includes(evento.key)) evento.preventDefault()
}
