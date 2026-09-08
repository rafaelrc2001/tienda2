import {
  ATRIBUTOS_TEXTO,
  OPERADORES_SEGMENTO,
  type AtributoSegmento,
  type OperadorSegmento,
  type ReglaSegmento,
} from '@/api/tipos'

/**
 * Reglas del constructor de segmentos (Word 4.9.3).
 *
 * Funciones puras, aparte del componente, porque son la parte más delicada
 * del motor de cupones y conviene poder probarlas aisladas — igual que el
 * backend hace con su `segmentacion.ts`.
 */

/**
 * Operadores válidos para un atributo.
 *
 * `contiene` solo tiene sentido sobre los atributos de texto: sobre un número
 * como `pedidos` o `totalGastado` no significa nada.
 */
export function operadoresDe(attr: AtributoSegmento): readonly OperadorSegmento[] {
  return ATRIBUTOS_TEXTO.includes(attr)
    ? OPERADORES_SEGMENTO
    : OPERADORES_SEGMENTO.filter((op) => op !== 'contiene')
}

/** Si un operador se puede usar con un atributo. */
export function operadorValido(attr: AtributoSegmento, op: OperadorSegmento): boolean {
  return operadoresDe(attr).includes(op)
}

/**
 * Corrige una regla cuyo operador dejó de valer al cambiar el atributo.
 *
 * Devuelve la regla ajustada; el llamante decide si la reemplaza. Cambiar de
 * `ciudad contiene X` a `pedidos` deja `pedidos = X`, no una regla imposible.
 */
export function normalizarRegla(regla: ReglaSegmento): ReglaSegmento {
  if (operadorValido(regla.attr, regla.op)) return regla
  return { ...regla, op: '=' }
}

export const ETIQUETA_ATRIBUTO: Record<AtributoSegmento, string> = {
  pedidos: 'Número de pedidos',
  totalGastado: 'Total gastado',
  diasSinComprar: 'Días sin comprar',
  diasComoCliente: 'Días como cliente',
  cliente: 'Cliente (nombre o teléfono)',
  sucursal: 'Sucursal',
  colonia: 'Colonia',
  ciudad: 'Ciudad',
  estado: 'Estado',
  mesCumpleanos: 'Mes de cumpleaños',
}
