<script setup lang="ts">
/**
 * Rutas → Liquidación: las entregas finalizadas, que esperan su corte.
 *
 * Aquí solo se elige cuál: «Liquidar» abre el corte en su propia vista. Las que
 * siguen sin iniciar o en curso están en Entregas y las ya cortadas en
 * Historial, así cada entrega aparece en una sola pestaña.
 *
 * También vuelve aquí la entrega cuya devolución rechazó Finanzas: su
 * liquidación se deshizo y hay que hacerla otra vez. Se marca en la lista para
 * que no parezca una más.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { fechaDia } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import type { EntregaRuta, TableroRutas } from '@/api/tipos'

/** Finalizadas y sin corte: las que ya volvieron y falta liquidar. */
const porLiquidar = ref<EntregaRuta[]>([])
const cargando = ref(true)
const error = ref('')

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    // El tablero pide un filtro de pedidos; aquí solo se usan las entregas.
    const tablero = await http.get<TableroRutas>('/admin/rutas', {
      query: { filtro: 'disponibles', limite: 1 },
    })
    porLiquidar.value = tablero.entregas.filter((e) => !e.cortada && e.finalizadaEn !== null)
  } catch (fallo) {
    error.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos cargar tus entregas.'
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)
</script>

<template>
  <div>
    <SkeletonList v-if="cargando" :cantidad="3" />

    <p v-else-if="error" class="error-bloque">
      {{ error }}
      <button type="button" class="enlace" @click="cargar">Reintentar</button>
    </p>

    <p v-else-if="porLiquidar.length === 0" class="empty-block">
      No tienes entregas por liquidar. Cuando finalices una, su corte se hace aquí.
    </p>

    <template v-else>
      <p class="seccion-titulo">Entregas por liquidar</p>
      <div class="tabla-envoltorio">
        <table class="tabla lineal una-fija">
          <thead>
            <tr>
              <th>Entrega</th>
              <th>Fecha</th>
              <th class="num">Pedidos</th>
              <th class="num">Entregados</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in porLiquidar" :key="e.id">
              <td>
                <span class="folio">{{ e.folio }}</span>
              </td>
              <td>{{ fechaDia(e.creadoEn) }}</td>
              <td class="num">{{ e.pedidos }}</td>
              <td class="num">{{ e.entregados }}</td>
              <td>
                <span v-if="e.rechazoDevolucion" class="mini-tag rechazada">
                  Devolución rechazada
                </span>
                <span v-else class="mini-tag">Finalizada</span>
              </td>
              <td class="accion">
                <RouterLink :to="`/admin/rutas/liquidacion/${e.id}`" class="btn-secondary abrir">
                  Liquidar →
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
/* Las mismas columnas y botón que la lista de Entregas. */
.tabla.lineal .abrir {
  display: inline-block;
  padding: 4px 12px;
  font-size: 12px;
  text-decoration: none;
  box-shadow: none;
}

.tabla .mini-tag.rechazada {
  color: var(--rojo);
}

.empty-block {
  margin: 0;
  padding: 12px 0;
}
</style>
