<script setup lang="ts">
/**
 * Rutas → Historial de una entrega: cómo le fue, en qué quedó su dinero y lo
 * que salió en ella.
 *
 * Tiene su propia vista, como la entrega y su liquidación: desplegada bajo la
 * fila del historial quedaba dentro de una tabla que se desplaza de lado, y en
 * el teléfono se cortaba.
 *
 * La API no tiene «una entrega del historial»: se pide la lista y se busca en
 * ella. Es la misma petición que la pestaña, así que el corte que se ve aquí
 * es el mismo que allí.
 */
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ErrorApi, http } from '@/api/http'
import SkeletonList from '@/components/SkeletonList.vue'
import DetalleHistorialEntrega from './rutas/DetalleHistorialEntrega.vue'
import { nombreEntrega } from './rutas/etiquetas'
import { estadoEnHistorial } from './rutas/liquidacion'
import type { Corte, EntregaEnHistorial } from '@/api/tipos'

const route = useRoute()

/** De vuelta a la pestaña de la que se viene, no a Entregas. */
const VOLVER = { path: '/admin/rutas', query: { ventana: 'historial' } }

/** El tope de la API: una entrega más vieja que eso ya no se encuentra aquí. */
const LIMITE = 200

const entrega = ref<EntregaEnHistorial | null>(null)
const cargando = ref(true)
const error = ref('')

let peticion = 0

async function cargar(): Promise<void> {
  const numero = ++peticion
  const id = String(route.params.id)
  entrega.value = null
  error.value = ''
  cargando.value = true
  try {
    const { entregas } = await http.get<{ entregas: EntregaEnHistorial[] }>(
      '/admin/rutas/historial',
      { query: { limite: LIMITE } },
    )
    if (numero !== peticion) return
    entrega.value = entregas.find((e) => e.id === id) ?? null
    if (!entrega.value) error.value = 'Esa entrega no está en tu historial.'
  } catch (fallo) {
    if (numero === peticion)
      error.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos cargar la entrega.'
  } finally {
    if (numero === peticion) cargando.value = false
  }
}

onMounted(cargar)
// De una entrega a otra sin salir de la vista.
watch(
  () => route.params.id,
  () => void cargar(),
)

/** Corregir, entregar dinero o cancelarlo devuelve el corte al día. */
function alCambiarCorte(corte: Corte): void {
  if (entrega.value) entrega.value = { ...entrega.value, corte }
}
</script>

<template>
  <div class="pantalla pantalla-rutas sin-colchon">
    <RouterLink :to="VOLVER" class="admin-back-inline">← Historial</RouterLink>

    <SkeletonList v-if="cargando" :cantidad="3" />

    <p v-else-if="error" class="error-bloque">
      {{ error }}
      <button type="button" class="enlace" @click="cargar">Reintentar</button>
    </p>

    <template v-else-if="entrega">
      <header class="cabeza">
        <div class="datos">
          <p class="titulo">
            {{ nombreEntrega(entrega) }}
            <span class="mini-tag">{{ estadoEnHistorial(entrega) }}</span>
          </p>
        </div>
      </header>

      <!-- La llave la vuelve a montar al pasar de una entrega a otra. -->
      <DetalleHistorialEntrega :key="entrega.id" :entrega="entrega" @corte="alCambiarCorte" />
    </template>
  </div>
</template>

<style scoped>
.pantalla {
  padding: 12px 18px 0;
}

.admin-back-inline {
  display: inline-block;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  padding: 0 0 8px;
  text-decoration: none;
}

/* La misma tarjeta que encabeza la entrega y su liquidación. */
.cabeza {
  display: flex;
  align-items: center;
  gap: 10px 16px;
  background: var(--white);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
  border-left: 4px solid var(--verde);
  padding: 12px 14px;
  margin-bottom: 12px;
}

.cabeza .datos {
  flex: 1;
  min-width: 0;
}

.cabeza .titulo {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 15px;
  color: var(--ink);
}
</style>
