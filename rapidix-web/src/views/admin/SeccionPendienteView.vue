<script setup lang="ts">
/**
 * Rutas, Operaciones y Finanzas: una sola vista para las tres.
 *
 * Llama al endpoint, recibe el 501 y **muestra el mensaje que da la API**. No
 * se inventa interfaz para lo que no está definido, ni se escribe aquí una
 * copia del texto: si el backend cambia la explicación, esto la sigue.
 */
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const mensaje = ref('')
const cargando = ref(true)

onMounted(consultar)
watch(() => route.path, consultar)

async function consultar(): Promise<void> {
  cargando.value = true
  mensaje.value = ''
  try {
    // Se espera que falle: si algún día responde 200, la sección ya existe.
    await http.get(route.path)
    mensaje.value = 'Esta sección ya está disponible en la API, pero su interfaz aún no existe.'
  } catch (fallo) {
    if (fallo instanceof ErrorApi && fallo.estado === 501) {
      mensaje.value = fallo.message
    } else if (fallo instanceof ErrorApi) {
      // Un 403 no debería llegar: el guard del router lo corta antes.
      ui.errorDeApi(fallo)
    }
  } finally {
    cargando.value = false
  }
}
</script>

<template>
  <div class="admin-placeholder">
    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <div class="ico">🚧</div>
    <p class="t">{{ route.meta.titulo }}</p>
    <p v-if="cargando" class="s">Consultando…</p>
    <p v-else class="s">{{ mensaje }}</p>
    <span class="badge-soon">En definición</span>
  </div>
</template>

<style scoped>
.admin-back-inline {
  display: inline-block;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  padding: 0 0 24px;
  text-decoration: none;
}
</style>
