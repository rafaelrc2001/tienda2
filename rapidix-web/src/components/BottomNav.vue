<script setup lang="ts">
/**
 * Barra inferior de la app de cliente, portada de `.bottom-nav` del mockup.
 *
 * Cupones solo lo ve el rol cliente. Destacados lleva la insignia de no
 * leídos que devuelve `GET /destacados`.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useDestacadosStore } from '@/stores/destacados'

const route = useRoute()
const auth = useAuthStore()
const destacados = useDestacadosStore()

interface ItemNav {
  ruta: string
  etiqueta: string
  visible: boolean
}

const items = computed<ItemNav[]>(() => [
  { ruta: '/', etiqueta: 'Home', visible: true },
  { ruta: '/tienda', etiqueta: 'Tienda', visible: true },
  { ruta: '/recetario', etiqueta: 'Recetario', visible: true },
  { ruta: '/cupones', etiqueta: 'Cupones', visible: auth.esCliente },
  { ruta: '/destacados', etiqueta: 'Destacados', visible: true },
])

/** `/` solo casa exacto; el resto también con sus subrutas. */
function activo(ruta: string): boolean {
  return ruta === '/' ? route.path === '/' : route.path.startsWith(ruta)
}
</script>

<template>
  <template v-for="item in items" :key="item.ruta">
    <RouterLink
      v-if="item.visible"
      :to="item.ruta"
      class="nav-item"
      :class="{ active: activo(item.ruta) }"
    >
      <span
        v-if="item.ruta === '/destacados' && destacados.noLeidos > 0"
        class="nav-badge"
        :aria-label="`${destacados.noLeidos} sin leer`"
        >{{ destacados.noLeidos }}</span
      >

      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
        <template v-if="item.ruta === '/'">
          <path d="M3 11l9-8 9 8" />
          <path d="M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10" />
        </template>
        <template v-else-if="item.ruta === '/tienda'">
          <path d="M3 9l1.5-5h15L21 9" />
          <path d="M3 9h18v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9z" />
          <path d="M9 13a3 3 0 006 0" />
        </template>
        <template v-else-if="item.ruta === '/recetario'">
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
        </template>
        <template v-else-if="item.ruta === '/cupones'">
          <path d="M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2v-6" />
          <path d="M2 7h20v5H2z" />
          <path d="M12 22V7" />
          <path d="M12 7C9.5 7 7 5.5 7 3.5S8.5 1 10 2s2 3 2 5c0-2 .5-4 2-5s3 .5 3 1.5S14.5 7 12 7z" />
        </template>
        <template v-else>
          <path d="M12 2l2.9 6.5 7.1.7-5.4 4.7 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9.2l7.1-.7z" />
        </template>
      </svg>

      <span class="nav-label">{{ item.etiqueta }}</span>
      <span class="nav-dot" />
    </RouterLink>
  </template>
</template>

<style scoped>
.nav-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: #9daac0;
  cursor: pointer;
  font-family: var(--font-heading);
  font-size: 9.5px;
  font-weight: 600;
  padding: 4px 8px;
  letter-spacing: 0.01em;
  transition: color 0.15s ease;
  text-decoration: none;
}

.nav-item svg {
  width: 21px;
  height: 21px;
  transition: transform 0.15s ease;
}

.nav-item.active {
  color: var(--gold);
}

.nav-item.active svg {
  transform: translateY(-2px);
}

.nav-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--gold);
  opacity: 0;
  margin-top: -2px;
}

.nav-item.active .nav-dot {
  opacity: 1;
}

.nav-badge {
  position: absolute;
  top: 0;
  right: 4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--terracotta);
  color: var(--white);
  font-size: 9px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
}
</style>
