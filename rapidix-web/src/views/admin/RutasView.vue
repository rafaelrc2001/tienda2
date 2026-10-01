<script setup lang="ts">
/**
 * Administración → Rutas: la pantalla del repartidor, en tres pestañas que son
 * tres momentos del día.
 *
 *  - **Entregas**, durante el reparto: sus viajes y «Crear entrega».
 *  - **Liquidación**, al volver a bodega: el corte de una entrega.
 *  - **Historial**, cualquier día: lo que pasó con cada entrega y lo que debe.
 *
 * Los indicadores (entregas, efectivo, devoluciones) no van aquí sino dentro
 * de cada entrega: son de un viaje, no del día. Cada
 * pestaña se vuelve a montar —y a pedir sus datos— en cada toque, aunque ya se
 * hubiera visitado: así nunca enseña datos viejos y no hay que refrescar las
 * que están escondidas. La pestaña va en la URL: al volver de una liquidación
 * se cae otra vez en Liquidación y no en Entregas.
 *
 * Cada entrega está en una sola pestaña, según en qué va: sin iniciar o en
 * curso en Entregas, finalizada en Liquidación y ya con corte en Historial.
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import VentanaEntregas from './rutas/VentanaEntregas.vue'
import VentanaLiquidacion from './rutas/VentanaLiquidacion.vue'
import VentanaHistorial from './rutas/VentanaHistorial.vue'

type Ventana = 'entregas' | 'liquidacion' | 'historial'

const VENTANAS: { id: Ventana; titulo: string }[] = [
  { id: 'entregas', titulo: 'Entregas' },
  { id: 'liquidacion', titulo: 'Liquidación' },
  { id: 'historial', titulo: 'Historial' },
]

const route = useRoute()
const router = useRouter()

const ventana = computed<Ventana>(() => {
  const pedida = route.query.ventana
  return VENTANAS.some((v) => v.id === pedida) ? (pedida as Ventana) : 'entregas'
})

/** Sube con cada toque de pestaña: cambia la `key` y la pestaña se vuelve a montar. */
const vuelta = ref(0)

function abrir(id: Ventana): void {
  vuelta.value++
  if (id !== ventana.value) {
    void router.replace({ query: id === 'entregas' ? {} : { ventana: id } })
  }
}
</script>

<template>
  <div class="pantalla pantalla-rutas sin-colchon">
    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <div class="subtab-row" role="tablist" aria-label="Rutas">
      <button
        v-for="v in VENTANAS"
        :key="v.id"
        type="button"
        role="tab"
        class="subtab"
        :class="{ active: ventana === v.id }"
        :aria-selected="ventana === v.id"
        :aria-controls="`ventana-${v.id}`"
        @click="abrir(v.id)"
      >
        {{ v.titulo }}
      </button>
    </div>

    <div :id="`ventana-${ventana}`" role="tabpanel">
      <VentanaEntregas v-if="ventana === 'entregas'" :key="`entregas-${vuelta}`" />
      <VentanaLiquidacion v-else-if="ventana === 'liquidacion'" :key="`liquidacion-${vuelta}`" />
      <VentanaHistorial v-else :key="`historial-${vuelta}`" />
    </div>
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

.subtab-row {
  margin: 0 0 12px;
}
</style>
