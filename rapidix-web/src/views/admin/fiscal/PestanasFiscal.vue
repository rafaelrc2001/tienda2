<script setup lang="ts">
/**
 * Las dos pantallas de Configuración → Fiscal: los datos del negocio con los
 * que se timbra y las facturas que ya se timbraron.
 */
const PESTANAS = [
  { id: 'datos', titulo: 'Datos fiscales', a: '/admin/configuracion/fiscal' },
  { id: 'facturacion', titulo: 'Facturación', a: '/admin/configuracion/fiscal/facturacion' },
] as const

defineProps<{ activa: (typeof PESTANAS)[number]['id'] }>()
</script>

<template>
  <nav class="subtab-row pestanas-fiscal" aria-label="Secciones de Fiscal">
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
.pestanas-fiscal {
  margin: 0 0 12px;
}

.subtab {
  text-decoration: none;
}
</style>
