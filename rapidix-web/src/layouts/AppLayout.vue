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
import CarritoWidget from '@/components/CarritoWidget.vue'

withDefaults(
  defineProps<{
    /** Título que se pinta en la barra superior. */
    titulo?: string
    /** `cliente` = columna estrecha; `admin` = columna ancha para tablas. */
    variante?: 'cliente' | 'admin'
    /** Oculta la barra inferior (login, detalle a pantalla completa…). */
    sinNav?: boolean
    /**
     * Pinta la hamburguesa. El visitante de la Tienda no tiene menú que
     * abrir: el drawer sale de `GET /admin/menu` y sin sesión estaría vacío.
     */
    conDrawer?: boolean
    /** Pinta el widget «Mi carrito». El personal del negocio no compra. */
    conCarrito?: boolean
  }>(),
  { titulo: '', variante: 'cliente', sinNav: false, conDrawer: true, conCarrito: false },
)

const emit = defineEmits<{ (e: 'menu'): void }>()
</script>

<template>
  <div class="app-frame" :class="`is-${variante}`">
    <div class="app-column">
      <header v-if="titulo" class="app-topbar">
        <button
          v-if="conDrawer"
          type="button"
          class="hamburger-btn"
          aria-label="Abrir menú de administración"
          @click="emit('menu')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M3 6h18M3 12h18M3 18h18" stroke-linecap="round" />
          </svg>
        </button>
        <!-- Ocupa el sitio de la hamburguesa para que el título siga centrado. -->
        <span v-else class="hueco-hamburguesa" aria-hidden="true" />
        <h1 class="topbar-title">{{ titulo }}</h1>

        <!--
          Arriba a la derecha va el carrito, que se abre desde cualquier
          pantalla. Mi Perfil vive dentro del menú de la hamburguesa.
        -->
        <CarritoWidget v-if="conCarrito" />
        <span v-else class="hueco-hamburguesa" aria-hidden="true" />
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
  padding: 12px 16px 10px;
  flex-shrink: 0;
  /* Cabezal naranja de marca; lo que va encima (título, iconos) en blanco. */
  background: var(--orange);
  color: var(--white);
  /*
   * Por encima de la barra inferior (40): el overlay del carrito sale de aquí
   * dentro y tiene que tapar también la cinta de abajo.
   */
  z-index: 50;
}

/* Tres rayas sueltas sobre el naranja, sin caja, igual que el carrito de enfrente. */
.hamburger-btn {
  width: 34px;
  height: 34px;
  border: none;
  background: transparent;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: inherit;
  flex-shrink: 0;
}

.hueco-hamburguesa {
  width: 34px;
  flex-shrink: 0;
}

.hamburger-btn svg {
  width: 24px;
  height: 24px;
}

.topbar-title {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 16px;
  color: var(--white);
  letter-spacing: 0.02em;
  margin: 0;
  text-align: center;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/*
 * Cinta de iconos blanca a todo el ancho, pegada al borde de abajo. Siempre a
 * la vista: la columna tiene altura fija y lo que desplaza es `.app-screen`.
 */
.app-bottom-nav {
  z-index: 40;
  flex-shrink: 0;
  display: flex;
  justify-content: space-around;
  align-items: center;
  background: var(--white);
  padding: 8px 6px calc(8px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--line);
  box-shadow: 0 -4px 14px rgba(42, 33, 26, 0.06);
}

/*
 * Si la pantalla trae una barra que se pega al menú (la de compra de la
 * Tienda), sobra el colchón inferior: un sticky no baja más allá del padding
 * del contenedor que desplaza, así que dejaría ese hueco.
 */
.app-column:has(.pegada-al-nav) .app-screen {
  padding-bottom: 0;
}
</style>
