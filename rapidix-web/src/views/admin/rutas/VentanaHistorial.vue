<script setup lang="ts">
/**
 * Rutas → Historial: las entregas del repartidor, de la más reciente a la más
 * vieja, con lo que pasó con su dinero.
 *
 * Vive aparte de Liquidación: allí está el corte que se arma hoy y aquí los
 * cerrados. Mezclarlos ponía dos montos distintos en la misma pantalla sin
 * saber cuál era cuál.
 *
 * Cada fila nace cerrada y enseña solo cuál entrega fue y cuándo: con ocho en
 * pantalla, ver todos los montos a la vez era puro scroll. Se despliega en la
 * fila de abajo, como los detalles de Operaciones y Finanzas.
 */
import { onMounted, reactive, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { fechaNumerica } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import DetalleHistorialEntrega from './DetalleHistorialEntrega.vue'
import { nombreEntrega } from './etiquetas'
import type { Corte, DetalleHistorial, EntregaEnHistorial } from '@/api/tipos'

const entregas = ref<EntregaEnHistorial[]>([])
const cargando = ref(true)
const error = ref('')
const abierta = ref<string | null>(null)

/** Lo que ya se pidió de cada entrega liquidada: no cambia, no se vuelve a pedir. */
const guardados = reactive(new Map<string, DetalleHistorial>())

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    entregas.value = (
      await http.get<{ entregas: EntregaEnHistorial[] }>('/admin/rutas/historial')
    ).entregas
  } catch (fallo) {
    error.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos cargar tu historial.'
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

function alternar(id: string): void {
  abierta.value = abierta.value === id ? null : id
}

/** Corregir o abonar devuelve el corte al día: se cambia en su fila y nada más. */
function alCambiarCorte(entregaId: string, corte: Corte): void {
  entregas.value = entregas.value.map((e) => (e.id === entregaId ? { ...e, corte } : e))
}
</script>

<template>
  <div>
    <SkeletonList v-if="cargando" :cantidad="4" />

    <p v-else-if="error" class="error-bloque">
      {{ error }}
      <button type="button" class="enlace" @click="cargar">Reintentar</button>
    </p>

    <p v-else-if="entregas.length === 0" class="empty-block">
      Todavía no tienes entregas ni cortes registrados.
    </p>

    <template v-else>
      <p class="seccion-titulo">Tus entregas ({{ entregas.length }})</p>
      <div class="tabla-envoltorio">
        <table class="tabla lineal historial">
          <thead>
            <tr>
              <th>Entrega</th>
              <th class="num">Fecha</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="entrega in entregas" :key="entrega.id">
              <tr :class="{ 'con-detalle': abierta === entrega.id }">
                <!-- El encabezado es el botón: toda la fila despliega. -->
                <td colspan="2" class="cabecera">
                  <button
                    type="button"
                    class="fila-boton"
                    :aria-expanded="abierta === entrega.id"
                    :aria-controls="`historial-${entrega.id}`"
                    @click="alternar(entrega.id)"
                  >
                    <span class="folio">{{ nombreEntrega(entrega) }}</span>
                    <span class="fecha">{{ fechaNumerica(entrega.creadoEn) }}</span>
                    <span
                      class="chevron"
                      :class="{ abierto: abierta === entrega.id }"
                      aria-hidden="true"
                    >
                      <svg viewBox="0 0 16 16" width="14" height="14">
                        <path
                          d="M4 6l4 4 4-4"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </span>
                  </button>
                </td>
              </tr>
              <tr
                v-if="abierta === entrega.id"
                :id="`historial-${entrega.id}`"
                class="fila-detalle"
              >
                <td colspan="2">
                  <DetalleHistorialEntrega
                    :entrega="entrega"
                    :guardado="guardados.get(entrega.id) ?? null"
                    @guardar="(d) => guardados.set(entrega.id, d)"
                    @corte="(c) => alCambiarCorte(entrega.id, c)"
                  />
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.historial .cabecera {
  padding: 0;
}

.fila-boton {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  background: none;
  border: 0;
  padding: 8px 14px;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.fila-boton .fecha {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
}

.fila-boton .chevron {
  margin: 0;
}

.empty-block {
  margin: 0;
  padding: 12px 0;
}
</style>
