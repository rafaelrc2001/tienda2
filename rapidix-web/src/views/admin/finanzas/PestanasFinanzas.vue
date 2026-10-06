<script setup lang="ts">
/**
 * Las cuatro pantallas del dinero, como pestañas: Pedidos, Cortes de ruta,
 * Ingresos y CXC.
 *
 * Cada una es su propia ruta y pinta esta misma tira arriba, así se pasa de
 * una a otra sin volver a Pedidos. Antes eran tres enlaces sueltos en la
 * esquina, que solo existían en la pantalla de Pedidos.
 */
const PESTANAS = [
  { id: 'pedidos', titulo: 'Pedidos', a: '/admin/finanzas' },
  { id: 'cortes', titulo: 'Cortes de ruta', a: '/admin/finanzas/cortes' },
  { id: 'ingresos', titulo: 'Ingresos', a: '/admin/finanzas/ingresos' },
  { id: 'cxc', titulo: 'CXC', a: '/admin/finanzas/cxc' },
] as const

defineProps<{ activa: (typeof PESTANAS)[number]['id'] }>()
</script>

<template>
  <nav class="subtab-row pestanas-finanzas" aria-label="Secciones de Finanzas">
    <RouterLink
      v-for="p in PESTANAS"
      :key="p.id"
      :to="p.a"
      class="subtab"
      :class="{ active: activa === p.id }"
      :aria-current="activa === p.id ? 'page' : undefined"
    >
      {{ p.titulo }}
    </RouterLink>
  </nav>
</template>

<style scoped>
/* El margen lateral lo pone la pantalla, que ya trae su relleno. */
.pestanas-finanzas {
  margin: 0 0 12px;
}

.subtab {
  text-decoration: none;
}
</style>
