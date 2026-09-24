/**
 * Achica una foto antes de subirla.
 *
 * La cámara de un teléfono saca fotos de 3 a 12 MB: con datos móviles tardan en
 * subir —la hoja se queda en «Subiendo…»— y muchas pasan del tope de 5 MB de la
 * API. Para ver que el pedido llegó bastan 1600 px por lado.
 *
 * Si el navegador no sabe redibujarla, o la versión reducida no pesa menos, se
 * devuelve el archivo tal cual: reducir es una mejora, nunca un requisito.
 */

/** Lado mayor de la foto ya reducida. */
export const LADO_MAXIMO = 1600
/** Calidad JPEG: a este tamaño no se nota y pesa una fracción. */
const CALIDAD = 0.82

/** Las medidas que le tocan a una imagen para que su lado mayor quepa en `lado`. */
export function medidasReducidas(
  ancho: number,
  alto: number,
  lado = LADO_MAXIMO,
): { ancho: number; alto: number } {
  const mayor = Math.max(ancho, alto)
  if (mayor <= lado) return { ancho, alto }
  const escala = lado / mayor
  return { ancho: Math.round(ancho * escala), alto: Math.round(alto * escala) }
}

export async function reducirImagen(archivo: File): Promise<File> {
  if (typeof createImageBitmap !== 'function') return archivo

  try {
    // `from-image` respeta la orientación EXIF: sin esto, las fotos verticales
    // del teléfono salen acostadas.
    const imagen = await createImageBitmap(archivo, { imageOrientation: 'from-image' })
    const { ancho, alto } = medidasReducidas(imagen.width, imagen.height)

    const lienzo = document.createElement('canvas')
    lienzo.width = ancho
    lienzo.height = alto
    const contexto = lienzo.getContext('2d')
    if (!contexto) return archivo
    contexto.drawImage(imagen, 0, 0, ancho, alto)
    imagen.close()

    const blob = await new Promise<Blob | null>((resolver) =>
      lienzo.toBlob(resolver, 'image/jpeg', CALIDAD),
    )
    if (!blob || blob.size >= archivo.size) return archivo

    const nombre = archivo.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], nombre, { type: 'image/jpeg' })
  } catch {
    return archivo
  }
}
