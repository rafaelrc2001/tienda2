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
 * que están escondidas. La pestaña va en la URL para que «Hacer mi corte» de
 * una entrega pueda llegar directo a su liquidación.
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
const entregaPedida = computed(() =>
  typeof route.query.entrega === 'string' ? route.query.entrega : null,
)

/** Sube con cada toque de pestaña: cambia la `key` y la pestaña se vuelve a montar. */
const vuelta = ref(0)

function abrir(id: Ventana): void {
  vuelta.value++
  if (id !== ventana.value || entregaPedida.value) {
    void router.replace({ query: id === 'entregas' ? {} : { ventana: id } })
  }
}

/** La entrega elegida en Liquidación queda en la URL: recargar vuelve a ella. */
function recordarEntrega(entregaId: string): void {
  void router.replace({ query: { ventana: 'liquidacion', entrega: entregaId } })
}

function alCortar(): void {
  void router.replace({ query: { ventana: 'liquidacion' } })
  vuelta.value++
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
      <VentanaLiquidacion
        v-else-if="ventana === 'liquidacion'"
        :key="`liquidacion-${vuelta}`"
        :entrega-inicial="entregaPedida"
        @elegir="recordarEntrega"
        @cortado="alCortar"
      />
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

<!--
  Lo que comparten las tres pestañas. Sin `scoped` porque cada pestaña es su
  propio componente; va colgado de `.pantalla-rutas` para no salirse de aquí.
-->
<style>
.pantalla-rutas .seccion-titulo {
  margin: 16px 0 6px;
  font-family: var(--font-heading);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
}

/* Cada bloque pinta su propio error, sin tumbar el resto de la pantalla. */
.pantalla-rutas .error-bloque {
  margin: 0;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  background: color-mix(in srgb, var(--orange) 10%, var(--white));
  border-left: 3px solid var(--orange-dark);
  border-radius: var(--radius-sm);
}

.pantalla-rutas .error-bloque .enlace {
  margin-left: 8px;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--terracotta-dark);
  text-decoration: underline;
  cursor: pointer;
}
</style>
