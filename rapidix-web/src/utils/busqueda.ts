/**
 * La búsqueda de las listas de pedidos (la lupa de la barra).
 *
 * Funciones puras. Cada pantalla dice qué textos de la fila se pueden buscar
 * —los que enseña, con sus nombres en pantalla y no los códigos: quien escribe
 * «pendiente» espera los «Pago pendiente»— y aquí solo se compara.
 */

/** Sin acentos ni mayúsculas: «credito» encuentra «Crédito». */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * Lo que coincide con lo escrito. Cada palabra tiene que aparecer, en
 * cualquier orden: «prueba pagado» son los pagados de «Cliente de prueba».
 * Vacío devuelve todo.
 */
export function filtrarPorTexto<T>(
  lista: T[],
  consulta: string,
  textosDe: (item: T) => (string | null | undefined)[],
): T[] {
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return lista
  return lista.filter((item) => {
    const texto = normalizar(textosDe(item).filter(Boolean).join(' '))
    return palabras.every((palabra) => texto.includes(palabra))
  })
}
