/**
 * Los enums de bodega, escritos como los lee un encargado.
 *
 * Viven aquí y no en cada ventana porque Movimientos los usa para capturar y
 * el historial para leer: si divergieran, el mismo movimiento se llamaría de
 * dos maneras en la misma pantalla.
 */
import type {
  AfectaInventario,
  EstadoTransferencia,
  MotivoMovimiento,
  RolProducto,
  TipoMovimiento,
} from '@/api/tipos'

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

/**
 * Lo que se puede capturar en Movimientos. La transferencia no es un tercer
 * tipo en la bitácora —allí deja salidas y entradas—, pero sí en la captura:
 * en vez de motivo y saldo pide la tienda de destino.
 */
export type TipoCaptura = TipoMovimiento | 'TRANSFERENCIA'

export const TIPOS_CAPTURA: { valor: TipoCaptura; etiqueta: string }[] = [
  ...TIPOS,
  { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia a tienda' },
]

const NOMBRE_ESTADO_TRANSFERENCIA: Record<EstadoTransferencia, string> = {
  PENDIENTE: 'Por aceptar',
  ACEPTADA: 'Aceptada',
  CANCELADA: 'Cancelada',
}

export function nombreEstadoTransferencia(estado: EstadoTransferencia): string {
  return NOMBRE_ESTADO_TRANSFERENCIA[estado]
}

export const AFECTA: { valor: AfectaInventario; etiqueta: string; ayuda: string }[] = [
  {
    valor: 'AMBOS',
    etiqueta: 'Ambos (físico y apt.)',
    ayuda: 'La mercancía entra o sale de verdad',
  },
  { valor: 'FISICO', etiqueta: 'Solo físico', ayuda: 'Llegó a bodega pero no se libera a venta' },
  { valor: 'APT', etiqueta: 'Solo apt. venta', ayuda: 'Aparta o libera lo que ya está en piso' },
]

/**
 * Motivos que se capturan a mano. `VENTA`, `ENTREGA` y `RUTA` no están: esos
 * movimientos los escribe el pedido al confirmarse, al entregarse en tienda y
 * al subir o bajar del camión, y ofrecerlos aquí sería invitar a descontar dos
 * veces la misma venta. `TRANSFERENCIA` tampoco: lo escribe la transferencia.
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
  ENTREGA: 'Entrega',
  RUTA: 'Ruta',
  TRANSFERENCIA: 'Transferencia',
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
