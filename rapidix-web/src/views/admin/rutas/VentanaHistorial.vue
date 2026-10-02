<script setup lang="ts">
/**
 * Rutas → Historial: las entregas ya liquidadas del repartidor, de la más
 * reciente a la más vieja, con lo que pasó con su dinero.
 *
 * Vive aparte de Liquidación: allí está el corte que se arma hoy y aquí los
 * ya liquidados. Mezclarlos ponía dos montos distintos en la misma pantalla
 * sin saber cuál era cuál.
 *
 * Cada fila nace cerrada y enseña cuál entrega fue, cuándo, el **estatus** de
 * su corte (Liquidado mientras Finanzas tenga algo por aceptar, Aceptado si ya
 * lo aceptó y queda adeudo, Cerrado si no debe nada) y el **adeudo**: es lo
 * que el repartidor viene a buscar. Los demás montos van en la fila de abajo,
 * que se despliega como los detalles de Operaciones y Finanzas.
 */
import { onMounted, reactive, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { dinero, fechaNumerica } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import DetalleHistorialEntrega from './DetalleHistorialEntrega.vue'
import { nombreEntrega } from './etiquetas'
import { faltanteDe, nombreEstadoCorte } from './liquidacion'
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

/**
 * El estatus del corte para la fila cerrada. Sin corte propio es una entrega
 * de las jornadas que se cortaban enteras: liquidada, sin más.
 */
function estatus(entrega: EntregaEnHistorial): string {
  return entrega.corte ? nombreEstadoCorte(entrega.corte.estado) : 'Liquidada'
}

/**
 * Lo que debe de esa entrega. Mientras Finanzas no acepte el dinero no hay
 * adeudo que decir: va una raya, que no es lo mismo que «no debe nada».
 */
function adeudo(entrega: EntregaEnHistorial): string {
  const { corte } = entrega
  if (!corte || corte.recibidoEn === null) return '—'
  return faltanteDe(corte) > 0 ? dinero(faltanteDe(corte)) : 'Sin adeudo'
}

function debe(entrega: EntregaEnHistorial): boolean {
  return entrega.corte?.recibidoEn != null && faltanteDe(entrega.corte) > 0
}

function alternar(id: string): void {
  abierta.value = abierta.value === id ? null : id
}

/** Corregir, entregar dinero o cancelarlo devuelve el corte al día: se cambia en su fila. */
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
      Todavía no tienes entregas liquidadas. Aparecen aquí al cerrar su corte.
    </p>

    <template v-else>
      <p class="seccion-titulo">Tus entregas ({{ entregas.length }})</p>
      <div class="tabla-envoltorio">
        <table class="tabla lineal historial">
          <thead>
            <tr>
              <th>Entrega</th>
              <th>Fecha</th>
              <th>Estatus</th>
              <th class="num">Adeudo</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="entrega in entregas" :key="entrega.id">
              <!-- Toda la fila despliega; la flecha es el botón que lo dice. -->
              <tr
                class="fila"
                :class="{ 'con-detalle': abierta === entrega.id }"
                @click="alternar(entrega.id)"
              >
                <td>
                  <div class="con-flecha">
                    <!-- La flecha va primero, como en Operaciones. -->
                    <button
                      type="button"
                      class="chevron"
                      :class="{ abierto: abierta === entrega.id }"
                      :aria-expanded="abierta === entrega.id"
                      :aria-controls="`historial-${entrega.id}`"
                      :aria-label="`Detalle de ${entrega.folio}`"
                      @click.stop="alternar(entrega.id)"
                    >
                      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                        <path
                          d="M4 6l4 4 4-4"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </button>
                    <div>
                      <span class="folio">{{ entrega.folio }}</span>
                      <span class="sub">{{ nombreEntrega(entrega) }}</span>
                    </div>
                  </div>
                </td>
                <td class="fecha">{{ fechaNumerica(entrega.creadoEn) }}</td>
                <td>
                  <span class="mini-tag" :class="{ cerrado: entrega.corte?.estado === 'CERRADO' }">
                    {{ estatus(entrega) }}
                  </span>
                </td>
                <td class="num importe" :class="{ debe: debe(entrega) }">{{ adeudo(entrega) }}</td>
              </tr>
              <tr
                v-if="abierta === entrega.id"
                :id="`historial-${entrega.id}`"
                class="fila-detalle"
              >
                <td colspan="4">
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
.historial {
  min-width: 460px;
}

.historial .fila {
  cursor: pointer;
}

/* La flecha a la izquierda del folio y el nombre, centrada con los dos. */
.con-flecha {
  display: flex;
  align-items: center;
}

.con-flecha .chevron {
  flex: none;
}

/* Cifras de ancho fijo: las fechas quedan en columna, dígito bajo dígito. */
.historial .fecha {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}

.tabla .mini-tag.cerrado {
  background: color-mix(in srgb, var(--verde) 15%, var(--white));
  color: var(--verde-compra);
}

.historial > tbody > tr > td.debe {
  color: var(--rojo);
}

.empty-block {
  margin: 0;
  padding: 12px 0;
}
</style>
