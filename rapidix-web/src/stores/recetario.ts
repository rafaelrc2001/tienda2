import { defineStore } from 'pinia'
import { ref } from 'vue'
import { http } from '@/api/http'
import type { CategoriaReceta, PestanaReceta, RecetaPausada } from '@/api/tipos'

export type PestanaRecetario = PestanaReceta | 'historial'

/**
 * Estado de navegación del Recetario (SPEC 02 §3.2): pestaña activa, filtro
 * de categoría, búsqueda y la receta en pausa.
 *
 * Las recetas en sí no se cachean: se piden cuando se necesitan.
 */
export const useRecetarioStore = defineStore('recetario', () => {
  const pestana = ref<PestanaRecetario>('recetario')
  const categoria = ref<CategoriaReceta | 'todas'>('todas')
  const busqueda = ref('')
  const pausada = ref<RecetaPausada | null>(null)

  async function cargarPausada(): Promise<void> {
    pausada.value = await http.get<RecetaPausada | null>('/recetario/pausada')
  }

  /** Pausar otra receta sustituye a la anterior: nunca coexisten dos. */
  async function pausar(recetaId: string): Promise<void> {
    pausada.value = await http.put<RecetaPausada>(`/recetas/${recetaId}/pausar`)
  }

  async function quitarPausa(): Promise<void> {
    await http.delete('/recetario/pausada')
    pausada.value = null
  }

  /** Al cerrar sesión: la receta en pausa y los filtros son de quien se va. */
  function olvidar(): void {
    pestana.value = 'recetario'
    categoria.value = 'todas'
    busqueda.value = ''
    pausada.value = null
  }

  return {
    pestana,
    categoria,
    busqueda,
    pausada,
    cargarPausada,
    pausar,
    quitarPausa,
    olvidar,
  }
})
