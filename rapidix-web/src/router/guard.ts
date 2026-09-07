import type { Seccion } from '@/api/tipos'

/**
 * Decisión del guard del router, aislada del router y de los stores.
 *
 * Se saca aquí para poder probarla sin montar la aplicación: es la regla que
 * decide qué ve cada rol y no puede romperse en silencio.
 */

/** Lo que el guard necesita saber de la ruta a la que se va. */
export interface DestinoGuard {
  fullPath: string
  nombre?: string
  publica?: boolean
  seccion?: Seccion
  soloCliente?: boolean
}

/** Lo que el guard necesita saber de la sesión. */
export interface SesionGuard {
  autenticado: boolean
  esCliente: boolean
  /** Secciones del menú que devolvió `GET /admin/menu`. */
  secciones: readonly Seccion[]
}

export type DecisionGuard =
  | { tipo: 'permitir' }
  | { tipo: 'redirigir'; a: string; query?: Record<string, string>; motivo?: string }

/** Inicio de cada rol: el cliente a la app, el personal al panel. */
export const inicioDe = (esCliente: boolean): string => (esCliente ? '/' : '/admin')

/**
 * Resuelve si se puede entrar a `destino`.
 *
 * **No lleva copia de `PERMISOS_POR_ROL`**: consulta `sesion.secciones`, que
 * viene del menú que devolvió la API.
 */
export function decidir(destino: DestinoGuard, sesion: SesionGuard): DecisionGuard {
  if (destino.publica) {
    // Con sesión abierta el login no tiene sentido: se va a su inicio.
    if (destino.nombre === 'login' && sesion.autenticado) {
      return { tipo: 'redirigir', a: inicioDe(sesion.esCliente) }
    }
    return { tipo: 'permitir' }
  }

  if (!sesion.autenticado) {
    return { tipo: 'redirigir', a: '/login', query: { destino: destino.fullPath } }
  }

  // Las pantallas de la app de cliente no las ve el personal del negocio.
  if (destino.soloCliente && !sesion.esCliente) {
    return { tipo: 'redirigir', a: '/admin' }
  }

  if (destino.seccion && !sesion.secciones.includes(destino.seccion)) {
    return {
      tipo: 'redirigir',
      a: '/admin',
      motivo: 'Tu rol no tiene acceso a esta sección.',
    }
  }

  return { tipo: 'permitir' }
}
