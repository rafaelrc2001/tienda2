/**
 * Los rangos de la lista de precios de un producto.
 *
 * La API solo guarda el **piso** de cada lista: el techo de una es el piso de
 * la siguiente menos uno, y la última no tiene techo. En el panel se capturan
 * los dos extremos porque leer «1–10, 11–15, 16 en adelante» es lo que hace la
 * tabla legible, pero escribir un techo no guarda un techo: guarda el piso de
 * la lista de al lado. Por eso los rangos no pueden encimarse ni dejar huecos
 * por mucho que se muevan los límites.
 *
 * Aquí solo está esa aritmética, sin Vue, para poder probarla a secas. Los
 * índices de lista son 0 = precio de venta (lista 1), 1 = lista 2, 2 = lista 3;
 * `escalones[n]` es la lista `n + 2`, igual que en la API.
 */

/** Una fila de la tabla. `null` = campo vacío, que es «esta lista no existe». */
export interface FilaEscalon {
  piso: number | null
  precio: number | null
}

/** `v-model.number` deja `''` al vaciar un campo: eso es «sin valor». */
export const sinValor = (v: number | string | null): boolean => v === null || v === ''

/**
 * Límite inferior de la lista `indice`.
 *
 * La lista 1 arranca siempre en la pieza 1: quien lleva una pieza tiene que
 * tener precio, así que ese extremo no se mueve.
 */
export function limiteInferior(escalones: FilaEscalon[], indice: number): number {
  if (indice === 0) return 1
  const piso = escalones[indice - 1]?.piso
  return sinValor(piso) ? 1 : Number(piso)
}

/**
 * Fila que le pone techo a la lista `indice`: la primera de las siguientes que
 * tenga piso. `-1` si esa lista es la última con datos y queda abierta.
 *
 * Se busca en vez de mirar la de justo debajo porque la tabla admite un hueco
 * —lista 2 vacía y lista 3 puesta— y al guardar esas filas se compactan.
 */
export function filaDelTecho(escalones: FilaEscalon[], indice: number): number {
  const salto = escalones.slice(indice).findIndex((f) => !sinValor(f.piso))
  return salto === -1 ? -1 : indice + salto
}

/** Límite superior de la lista `indice`. `null` = «En adelante». */
export function limiteSuperior(escalones: FilaEscalon[], indice: number): number | null {
  const fila = filaDelTecho(escalones, indice)
  return fila === -1 ? null : Number(escalones[fila].piso) - 1
}

/**
 * Mueve el techo de la lista `indice`, escribiendo `techo + 1` en el piso de
 * la siguiente. Muta `escalones` y devuelve el techo que quedó.
 *
 * El valor se recorta a lo que deja sitio a los vecinos: ni por debajo del piso
 * de la propia lista —dejaría un rango al revés— ni tan arriba que se coma a la
 * de después. `null` abre la lista y borra la siguiente, que sin piso no se
 * cobra.
 */
export function moverTecho(
  escalones: FilaEscalon[],
  indice: number,
  valor: number | null,
): number | null {
  const existente = filaDelTecho(escalones, indice)
  // Sin lista siguiente todavía, el techo estrena la fila de justo debajo.
  const fila = existente === -1 ? indice : existente
  if (!escalones[fila]) return limiteSuperior(escalones, indice)

  if (valor === null) {
    escalones[fila].piso = null
  } else {
    let techo = Math.max(valor, limiteInferior(escalones, indice))
    const posterior = escalones[fila + 1]
    // A la lista de en medio hay que dejarle al menos una pieza que cobrar.
    if (posterior && !sinValor(posterior.piso)) techo = Math.min(techo, Number(posterior.piso) - 2)
    escalones[fila].piso = techo + 1
  }

  return limiteSuperior(escalones, indice)
}

/**
 * Mueve el piso de la lista `i + 2`, el otro extremo del mismo rango. Muta
 * `escalones` y devuelve el piso que quedó.
 *
 * Va recortado como el techo y por el mismo motivo: es el mismo dato mirado
 * del revés, así que tocar un extremo o el otro tiene que dejar la tabla igual
 * de cuadrada.
 */
export function moverPiso(
  escalones: FilaEscalon[],
  i: number,
  valor: number | null,
): number | null {
  const fila = escalones[i]
  if (!fila) return null

  if (valor === null) {
    fila.piso = null
    return null
  }

  // Arranca después de donde arranca la lista de arriba; la 2, en la pieza 2.
  let piso = Math.max(valor, limiteInferior(escalones, i) + 1)
  const posterior = escalones[i + 1]
  if (posterior && !sinValor(posterior.piso)) piso = Math.min(piso, Number(posterior.piso) - 1)

  fila.piso = piso
  return piso
}
