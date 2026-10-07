<script setup lang="ts">
/**
 * Administración → PDV: el punto de venta de una tienda, en tres pestañas.
 *
 *  - **Punto de Venta**: el turno del cajero y su caja. Los pedidos se
 *    capturan, se entregan y se cobran ahí mismo.
 *  - **Inventario**: lo que bodega le mandó a la tienda —que aquí se acepta—
 *    y lo que la tienda tiene.
 *  - **Corte de caja**: el total de los pedidos del turno, y su cierre.
 *
 * Como en Rutas, la pestaña va en la URL y cada una se vuelve a montar —y a
 * pedir sus datos— en cada toque: así nunca enseña datos viejos.
 *
 * `pantalla-pdv` le pide al layout una columna más ancha que la del resto del
 * panel: la caja son tres columnas y en 900px no caben.
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import VentanaInventarioTienda from './pdv/VentanaInventarioTienda.vue'
import VentanaPuntoDeVenta from './pdv/VentanaPuntoDeVenta.vue'
import VentanaCorteDeCaja from './pdv/VentanaCorteDeCaja.vue'

type Ventana = 'pdv' | 'inventario' | 'corte'

const VENTANAS: { id: Ventana; titulo: string }[] = [
  { id: 'pdv', titulo: 'Punto de Venta' },
  { id: 'inventario', titulo: 'Inventario' },
  { id: 'corte', titulo: 'Corte de caja' },
]

const route = useRoute()
const router = useRouter()

const ventana = computed<Ventana>(() => {
  const pedida = route.query.ventana
  return VENTANAS.some((v) => v.id === pedida) ? (pedida as Ventana) : 'pdv'
})

/** Sube con cada toque de pestaña: cambia la `key` y la pestaña se vuelve a montar. */
const vuelta = ref(0)

function abrir(id: Ventana): void {
  vuelta.value++
  if (id !== ventana.value) {
    void router.replace({ query: id === 'pdv' ? {} : { ventana: id } })
  }
}
</script>

<template>
  <div class="pantalla pantalla-pdv sin-colchon">
    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <div class="subtab-row" role="tablist" aria-label="Punto de Venta">
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
      <VentanaInventarioTienda v-if="ventana === 'inventario'" :key="`inventario-${vuelta}`" />
      <VentanaPuntoDeVenta v-else-if="ventana === 'pdv'" :key="`pdv-${vuelta}`" />
      <VentanaCorteDeCaja v-else :key="`corte-${vuelta}`" />
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
