<script setup lang="ts">
/**
 * Lista para filtrar los pedidos por tienda, en Operaciones y Finanzas.
 *
 * El valor es lo que espera `?tienda=` de la API: vacío para todas, `bodega`
 * para lo que no pasó por ninguna tienda (domicilio y ruta) o el id de una
 * tienda. Sirve para encontrar el pedido que tiene apartado el inventario de
 * una tienda.
 */
import { onMounted, ref } from 'vue'
import { http } from '@/api/http'
import type { TiendaParaRecoger } from '@/api/tipos'

const tienda = defineModel<string>({ required: true })

const tiendas = ref<TiendaParaRecoger[]>([])

onMounted(async () => {
  // Si no cargan, la lista se queda con «Todas» y «Bodega»: filtrar por
  // tienda no es motivo para tumbar la pantalla.
  try {
    tiendas.value = await http.get<TiendaParaRecoger[]>('/tiendas')
  } catch {
    tiendas.value = []
  }
})
</script>

<template>
  <label class="selector-tienda">
    <span class="etiqueta">Tienda</span>
    <select v-model="tienda" class="select-input">
      <option value="">Todas</option>
      <option value="bodega">Bodega (domicilio y ruta)</option>
      <option v-for="t in tiendas" :key="t.id" :value="t.id">{{ t.nombre }}</option>
    </select>
  </label>
</template>

<style scoped>
.selector-tienda {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 10px;
}

.etiqueta {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  color: var(--muted);
}

/* 16px reales: con menos, Safari en iPhone amplía la página al enfocar. */
.select-input {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  font-size: 16px;
}
</style>
