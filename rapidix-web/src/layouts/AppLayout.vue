<script setup lang="ts">
/**
 * Marco de la aplicación.
 *
 * Porta la estructura del mockup —barra superior, área de pantallas, barra
 * inferior— pero NO su marco de teléfono: aquí no hay `.phone-shell`, ni
 * notch, ni barra de estado simulada. En móvil la app ocupa la pantalla; en
 * escritorio se centra como una columna sobre el fondo crema.
 *
 * El ancho de esa columna lo decide `variante`: la app de cliente conserva la
 * medida del mockup y las vistas de administración con tablas se ensanchan.
 */
withDefaults(
  defineProps<{
    /** Título que se pinta en la barra superior. */
    titulo?: string
    /** `cliente` = columna estrecha; `admin` = columna ancha para tablas. */
    variante?: 'cliente' | 'admin'
    /** Oculta la barra inferior (login, detalle a pantalla completa…). */
    sinNav?: boolean
  }>(),
  { titulo: '', variante: 'cliente', sinNav: false },
)

const emit = defineEmits<{ (e: 'menu'): void }>()
</script>

<template>
  <div class="app-frame" :class="`is-${variante}`">
    <div class="app-column">
      <header v-if="titulo" class="app-topbar">
        <button
          type="button"
          class="hamburger-btn"
          aria-label="Abrir menú de administración"
          @click="emit('menu')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M3 6h18M3 12h18M3 18h18" stroke-linecap="round" />
          </svg>
        </button>
        <h1 class="topbar-title">{{ titulo }}</h1>
        <!-- Equilibra el botón para que el título quede centrado. -->
        <span class="topbar-spacer" aria-hidden="true" />
      </header>

      <main class="app-screen">
        <slot />
      </main>

      <nav v-if="!sinNav" class="app-bottom-nav">
        <slot name="nav" />
      </nav>
    </div>

    <!-- Toasts, modales y hojas inferiores. -->
    <slot name="overlay" />
  </div>
</template>

<style scoped>
.app-frame {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.app-column {
  width: 100%;
  max-width: var(--ancho-cliente);
  /*
   * Altura fija, no mínima: el contenido se desplaza DENTRO de la columna y
   * la barra inferior no se va nunca de la pantalla, igual que en el mockup.
   */
  height: 100vh;
  height: 100dvh;
  background: var(--cream);
  display: flex;
  flex-direction: column;
  position: relative;
  /* Nada puede desbordar en horizontal, ni en un móvil de 390px. */
  overflow-x: hidden;
}

.is-admin .app-column {
  max-width: var(--ancho-admin);
}

/* En escritorio la columna se despega del fondo y se ve como tal. */
@media (min-width: 700px) {
  .app-frame {
    padding: 24px 16px;
  }

  .app-column {
    height: calc(100dvh - 48px);
    border-radius: var(--radius-lg);
    box-shadow: 0 30px 70px rgba(20, 15, 8, 0.28);
    overflow: hidden;
  }
}

.app-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 8px;
  flex-shrink: 0;
  background: var(--cream);
  z-index: 30;
}

.hamburger-btn {
  width: 34px;
  height: 34px;
  border-radius: 11px;
  border: none;
  background: var(--white);
  box-shadow: var(--shadow);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--ink);
  flex-shrink: 0;
}

.hamburger-btn svg {
  width: 17px;
  height: 17px;
}

.topbar-title {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 15px;
  color: var(--terracotta-dark);
  letter-spacing: 0.02em;
  margin: 0;
  text-align: center;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topbar-spacer {
  width: 34px;
  flex-shrink: 0;
}

.app-screen {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  /* Colchón para que la última fila no quede pegada al borde. */
  padding-bottom: 18px;
  scrollbar-width: none;
}

.app-screen::-webkit-scrollbar {
  display: none;
}

.app-bottom-nav {
  z-index: 40;
  flex-shrink: 0;
  display: flex;
  justify-content: space-around;
  align-items: center;
  background: var(--navy);
  padding: 12px 6px 10px;
  border-radius: 24px 24px 30px 30px;
  margin: 0 8px 8px;
  box-shadow: 0 -6px 18px rgba(0, 0, 0, 0.18);
}
</style>
