import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ErrorApi } from '@/api/http'

export type TipoToast = 'info' | 'exito' | 'error'

export interface Toast {
  id: number
  mensaje: string
  tipo: TipoToast
}

const DURACION_MS = 3200

/**
 * Estado transversal de la interfaz: la cola de toasts y el drawer de
 * administración (SPEC 02 §3.2).
 *
 * Es una cola de verdad, no un único toast: dos acciones seguidas no se
 * pisan la una a la otra como pasaba en el mockup.
 */
export const useUiStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([])
  const drawerAbierto = ref(false)

  let siguienteId = 1
  const temporizadores = new Map<number, ReturnType<typeof setTimeout>>()

  function mostrar(mensaje: string, tipo: TipoToast = 'info'): number {
    const id = siguienteId++
    toasts.value.push({ id, mensaje, tipo })
    temporizadores.set(
      id,
      setTimeout(() => cerrar(id), DURACION_MS),
    )
    return id
  }

  function cerrar(id: number): void {
    const temporizador = temporizadores.get(id)
    if (temporizador) {
      clearTimeout(temporizador)
      temporizadores.delete(id)
    }
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  const exito = (mensaje: string): number => mostrar(mensaje, 'exito')
  const info = (mensaje: string): number => mostrar(mensaje, 'info')
  const error = (mensaje: string): number => mostrar(mensaje, 'error')

  /**
   * Muestra el mensaje que dio la API, no uno inventado.
   *
   * Los errores de validación no pasan por aquí: se pintan bajo su campo con
   * `ErrorApi.porCampo`. Esto es para los errores de acción.
   */
  function errorDeApi(fallo: unknown): void {
    if (fallo instanceof ErrorApi) {
      // Un 401 ya manda al login con su propio aviso; no hace falta el toast.
      if (fallo.estado === 401) return
      error(fallo.message)
      return
    }
    error('No pudimos completar la operación.')
  }

  function abrirDrawer(): void {
    drawerAbierto.value = true
  }

  function cerrarDrawer(): void {
    drawerAbierto.value = false
  }

  return {
    toasts,
    drawerAbierto,
    mostrar,
    cerrar,
    exito,
    info,
    error,
    errorDeApi,
    abrirDrawer,
    cerrarDrawer,
  }
})
