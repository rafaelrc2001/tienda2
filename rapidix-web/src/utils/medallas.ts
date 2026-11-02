import bronce from '@/assets/medallas/bronce.svg'
import oro from '@/assets/medallas/oro.webp'
import plata from '@/assets/medallas/plata.webp'
import platino from '@/assets/medallas/platino.svg'

/**
 * La medalla de cada nivel de cashback. Los nombres los teclea el negocio en
 * Config. Niveles, así que se buscan por su raíz y no por el nombre exacto.
 * El emoji es para las frases de texto; la imagen, para la tarjeta de Mi Perfil.
 */
const MEDALLAS: { raiz: string; emoji: string; imagen: string }[] = [
  { raiz: 'bronce', emoji: '🥉', imagen: bronce },
  { raiz: 'plata', emoji: '🥈', imagen: plata },
  { raiz: 'oro', emoji: '🥇', imagen: oro },
  // Platino (o Diamante) en el mismo modelo de medalla con listones que los demás.
  { raiz: 'diamante', emoji: '💎', imagen: platino },
  { raiz: 'platino', emoji: '💎', imagen: platino },
]

function buscar(nivel: string | null | undefined) {
  const nombre = nivel?.toLowerCase() ?? ''
  return MEDALLAS.find((medalla) => nombre.includes(medalla.raiz))
}

/** Un nivel con otro nombre (o sin nivel) se lleva una medalla genérica. */
export function emojiDeNivel(nivel: string | null | undefined): string {
  return buscar(nivel)?.emoji ?? '🏅'
}

/** `null` si el nivel no tiene imagen: quien la pinta cae a `emojiDeNivel`. */
export function imagenDeNivel(nivel: string | null | undefined): string | null {
  return buscar(nivel)?.imagen ?? null
}
