import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { http } from '@/api/http'
import type { Destacados } from '@/api/tipos'

/**
 * Noticias, avisos y la insignia de no leídos.
 *
 * Vive en un store porque la insignia se pinta en la barra inferior, no solo
 * en la pantalla de Destacados: dos sitios que tienen que ver el mismo número.
 */
export const useDestacadosStore = defineStore('destacados', () => {
  const datos = ref<Destacados | null>(null)
  const cargando = ref(false)

  const noLeidos = computed(() => datos.value?.noLeidos ?? 0)
  const noticias = computed(() => datos.value?.noticias ?? [])
  const avisos = computed(() => datos.value?.avisos ?? [])

  async function cargar(): Promise<void> {
    cargando.value = true
    try {
      datos.value = await http.get<Destacados>('/destacados')
    } finally {
      cargando.value = false
    }
  }

  /** Se llama al abrir la sección: apaga la insignia. */
  async function marcarLeido(): Promise<void> {
    await http.post<{ noLeidos: 0 }>('/destacados/leido')
    if (datos.value) datos.value.noLeidos = 0
  }

  /** Al cerrar sesión: la insignia y los avisos son de quien se acaba de ir. */
  function olvidar(): void {
    datos.value = null
    cargando.value = false
  }

  return { datos, cargando, noLeidos, noticias, avisos, cargar, marcarLeido, olvidar }
})
