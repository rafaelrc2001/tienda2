<script setup lang="ts">
/**
 * Raíz de la aplicación.
 *
 * Tres estados: pantalla de carga mientras se revalida el token guardado,
 * login a pantalla completa cuando no hay sesión, y el layout con la vista
 * activa cuando la hay.
 */
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from '@/layouts/AppLayout.vue'
import ToastHost from '@/components/ToastHost.vue'
import BottomNav from '@/components/BottomNav.vue'
import AdminDrawer from '@/components/AdminDrawer.vue'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { useDestacadosStore } from '@/stores/destacados'

const auth = useAuthStore()
const ui = useUiStore()
const destacados = useDestacadosStore()
const route = useRoute()

/** El login ocupa la pantalla: sin barra superior ni barra inferior. */
const sinMarco = computed(() => route.meta.publica === true)
const titulo = computed(() => (route.meta.titulo as string | undefined) ?? 'Rapidix')
const enAdmin = computed(() => route.path.startsWith('/admin'))
const variante = computed<'cliente' | 'admin'>(() => (enAdmin.value ? 'admin' : 'cliente'))

/**
 * La insignia de Destacados se pinta en la barra inferior, así que hace falta
 * en cuanto hay sesión, no solo al abrir esa pantalla.
 */
watch(
  () => auth.autenticado,
  (hay) => {
    if (hay && destacados.datos === null) destacados.cargar().catch(() => {})
  },
  { immediate: true },
)
</script>

<template>
  <!-- Revalidando el token: ni login ni app, para no pintar una y luego otra. -->
  <div v-if="auth.cargando" class="arrancando">
    <div class="logo-bowl">
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M4 12h16M14 8l4 4-4 4"
          stroke="#FBF3E7"
          stroke-width="2.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>
    <p class="cargando-texto">Cargando tu sesión…</p>
  </div>

  <template v-else-if="sinMarco">
    <RouterView />
    <ToastHost />
  </template>

  <AppLayout
    v-else
    :titulo="titulo"
    :variante="variante"
    @menu="ui.abrirDrawer()"
  >
    <RouterView />

    <template #nav>
      <BottomNav />
    </template>

    <template #overlay>
      <AdminDrawer />
      <ToastHost />
    </template>
  </AppLayout>
</template>

<style scoped>
.arrancando {
  min-height: 100dvh;
  background: var(--cream);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
}

.logo-bowl {
  width: 78px;
  height: 52px;
  background: var(--terracotta);
  border-radius: 0 0 40px 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: latido 1.2s ease-in-out infinite;
}

.logo-bowl svg {
  width: 38px;
  height: 38px;
}

.cargando-texto {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 13px;
  color: var(--muted);
  margin: 0;
}

@keyframes latido {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .logo-bowl {
    animation: none;
  }
}
</style>
