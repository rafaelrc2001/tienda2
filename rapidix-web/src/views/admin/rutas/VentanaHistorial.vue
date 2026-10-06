<script setup lang="ts">
/**
 * Rutas → Historial: las entregas ya liquidadas del repartidor, de la más
 * reciente a la más vieja, con lo que pasó con su dinero.
 *
 * Vive aparte de Liquidación: allí está el corte que se arma hoy y aquí los
 * ya liquidados. Mezclarlos ponía dos montos distintos en la misma pantalla
 * sin saber cuál era cuál.
 *
 * Cada fila enseña cuál entrega fue, cuándo, el **estatus** de su corte
 * (Liquidado mientras Finanzas tenga algo por aceptar, Aceptado si ya lo
 * aceptó y queda adeudo, Cerrado si no debe nada) y el **adeudo**: es lo que
 * el repartidor viene a buscar. Lo demás va en su propia vista, que abre
 * «Ver →», igual que las otras dos pestañas abren la entrega y su liquidación.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { dinero, fechaNumerica } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import { faltanteDe, nombreEstadoCorte } from './liquidacion'
import type { EntregaEnHistorial } from '@/api/tipos'

const entregas = ref<EntregaEnHistorial[]>([])
const cargando = ref(true)
const error = ref('')

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
 * El estatus del corte. Sin corte propio es una entrega de las jornadas que
 * se cortaban enteras: liquidada, sin más.
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
        <table class="tabla lineal una-fija historial">
          <thead>
            <tr>
              <th>Entrega</th>
              <th>Fecha</th>
              <th>Estatus</th>
              <th class="num">Adeudo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entrega in entregas" :key="entrega.id">
              <td>
                <span class="folio">{{ entrega.folio }}</span>
              </td>
              <td class="fecha">{{ fechaNumerica(entrega.creadoEn) }}</td>
              <td>
                <span class="mini-tag" :class="{ cerrado: entrega.corte?.estado === 'CERRADO' }">
                  {{ estatus(entrega) }}
                </span>
              </td>
              <td class="num importe" :class="{ debe: debe(entrega) }">{{ adeudo(entrega) }}</td>
              <td class="accion">
                <RouterLink
                  :to="`/admin/rutas/historial/${entrega.id}`"
                  class="btn-secondary abrir"
                >
                  Ver →
                </RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.historial {
  min-width: 540px;
}

/* Las mismas columnas y botón que las listas de Entregas y Liquidación. */
.tabla.lineal .abrir {
  display: inline-block;
  padding: 4px 12px;
  font-size: 12px;
  text-decoration: none;
  box-shadow: none;
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
