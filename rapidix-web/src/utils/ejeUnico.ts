import type { Directive } from 'vue'

/**
 * Directiva `v-eje-unico`: en una caja que desplaza a lo ancho y a lo alto,
 * cada gesto con el dedo mueve un solo eje.
 *
 * En el teléfono el dedo nunca va recto: sin esto la tabla se desplaza en
 * diagonal y parece que se tambalea. El eje se decide con los primeros
 * píxeles del gesto y el otro se regresa a donde estaba en cada `scroll`.
 * Se corrige en el evento de scroll y no con `preventDefault` para conservar
 * la inercia nativa; por eso el eje sigue fijo tras soltar, mientras dura el
 * deslizamiento, hasta el siguiente toque. El ratón y la rueda no pasan por
 * aquí: sin toque no hay eje.
 */

/** Píxeles de recorrido antes de decidir hacia dónde va el gesto. */
const UMBRAL = 8

interface Estado {
  x: number
  y: number
  left: number
  top: number
  eje: 'x' | 'y' | null
  limpiar: () => void
}

const estados = new WeakMap<HTMLElement, Estado>()

export const vEjeUnico: Directive<HTMLElement> = {
  mounted(caja) {
    const estado: Estado = { x: 0, y: 0, left: 0, top: 0, eje: null, limpiar: () => {} }

    const alTocar = (e: TouchEvent): void => {
      const t = e.touches[0]
      if (!t) return
      Object.assign(estado, {
        x: t.clientX,
        y: t.clientY,
        left: caja.scrollLeft,
        top: caja.scrollTop,
        eje: null,
      })
    }

    const alMover = (e: TouchEvent): void => {
      const t = e.touches[0]
      if (!t || estado.eje) return
      const dx = Math.abs(t.clientX - estado.x)
      const dy = Math.abs(t.clientY - estado.y)
      if (Math.max(dx, dy) < UMBRAL) return
      estado.eje = dx > dy ? 'x' : 'y'
    }

    const alDesplazar = (): void => {
      if (estado.eje === 'x' && caja.scrollTop !== estado.top) caja.scrollTop = estado.top
      if (estado.eje === 'y' && caja.scrollLeft !== estado.left) caja.scrollLeft = estado.left
    }

    caja.addEventListener('touchstart', alTocar, { passive: true })
    caja.addEventListener('touchmove', alMover, { passive: true })
    caja.addEventListener('scroll', alDesplazar, { passive: true })
    estado.limpiar = () => {
      caja.removeEventListener('touchstart', alTocar)
      caja.removeEventListener('touchmove', alMover)
      caja.removeEventListener('scroll', alDesplazar)
    }
    estados.set(caja, estado)
  },
  unmounted(caja) {
    estados.get(caja)?.limpiar()
    estados.delete(caja)
  },
}
