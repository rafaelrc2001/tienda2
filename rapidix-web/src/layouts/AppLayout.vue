<script setup lang="ts">
/**
 * Marco de la aplicación.
 *
 * Porta la estructura del mockup —barra superior, área de pantallas, barra
 * inferior— pero NO su marco de teléfono: aquí no hay `.phone-shell`, ni
 * notch, ni barra de estado simulada. En móvil la app ocupa la pantalla; en
 * escritorio se centra como una columna sobre el fondo gris.
 *
 * El ancho de esa columna lo decide `variante`: la app de cliente conserva la
 * medida del mockup y las vistas de administración con tablas se ensanchan.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import CarritoWidget from '@/components/CarritoWidget.vue'

const props = withDefaults(
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

/**
 * La cinta de iconos se esconde al bajar y vuelve al subir.
 *
 * Quien desplaza es `.app-screen`, no `window`, así que el oyente va sobre esa
 * caja. Esconderla no es solo moverla: también se le come su propio hueco con
 * un margen negativo, porque si no quedaría una franja crema al fondo y no se
 * ganaría nada de pantalla.
 */
const pantalla = ref<HTMLElement | null>(null)
const cinta = ref<HTMLElement | null>(null)
const navOculto = ref(false)
/** Alto real de la cinta; alimenta el margen negativo que colapsa su hueco. */
const altoNav = ref(0)

/** Píxeles seguidos en una dirección antes de cambiar de estado. */
const UMBRAL = 12

let ultimoY = 0
/** Recorrido acumulado desde el último cambio de sentido. */
let acumulado = 0
let observador: ResizeObserver | null = null

function alDesplazar() {
  const caja = pantalla.value
  if (!caja) return

  const y = caja.scrollTop
  const delta = y - ultimoY
  ultimoY = y

  // Arriba del todo la cinta siempre está a la vista.
  if (y <= altoNav.value) {
    acumulado = 0
    navOculto.value = false
    return
  }

  /*
   * Cerca del final no se toca el estado: esconder la cinta agranda
   * `.app-screen`, el navegador recorta el scroll sobrante y ese recorte
   * dispara este mismo manejador en sentido contrario, que la volvería a
   * mostrar, y así en bucle.
   */
  if (caja.scrollHeight - (y + caja.clientHeight) <= altoNav.value + 8) return

  // Un cambio de sentido empieza a contar de cero.
  if (delta > 0 !== acumulado > 0) acumulado = 0
  acumulado += delta

  if (acumulado > UMBRAL) navOculto.value = true
  else if (acumulado < -UMBRAL) navOculto.value = false
}

onMounted(() => {
  if (props.sinNav) return
  pantalla.value?.addEventListener('scroll', alDesplazar, { passive: true })

  // El alto cambia con el área segura del móvil y al ocultarse «Cupones».
  if (cinta.value && typeof ResizeObserver !== 'undefined') {
    observador = new ResizeObserver(() => {
      // Encogida no mide lo que ocupa: el valor bueno es el de cuando está puesta.
      if (!navOculto.value && cinta.value) altoNav.value = cinta.value.offsetHeight
    })
    observador.observe(cinta.value)
  }
})

onBeforeUnmount(() => {
  pantalla.value?.removeEventListener('scroll', alDesplazar)
  observador?.disconnect()
})
</script>

<template>
  <div class="app-frame" :class="`is-${variante}`">
    <div class="app-column" :style="{ '--alto-nav': `${altoNav}px` }">
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

      <main ref="pantalla" class="app-screen">
        <slot />
      </main>

      <nav v-if="!sinNav" ref="cinta" class="app-bottom-nav" :class="{ oculta: navOculto }">
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
  /*
   * Nada puede desbordar, ni en horizontal en un móvil de 390px ni en vertical
   * cuando la cinta de iconos se desliza fuera: recortarla aquí es lo que hace
   * que desaparezca en lugar de sacarle barra de scroll a la columna.
   */
  overflow: hidden;
}

/*
 * Franja de la barra de estado: el hueco del reloj, el wifi y la batería.
 *
 * Con `viewport-fit=cover` la app llega hasta el borde de arriba del teléfono,
 * así que ese alto hay que pintarlo o se ve el fondo del `body` asomando sobre
 * el cabezal. Va en naranja de marca, no del color del cabezal: es el remate
 * del teléfono, no parte de la barra.
 *
 * Es el primer elemento de la columna, que es flex: se lleva su alto y empuja
 * el cabezal hacia abajo. En escritorio el inset vale 0 y no ocupa nada.
 */
.app-column::before {
  content: '';
  flex-shrink: 0;
  height: env(safe-area-inset-top, 0px);
  background: var(--orange);
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
    box-shadow: 0 30px 70px rgba(0, 0, 0, 0.28);
  }
}

.app-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 10px;
  flex-shrink: 0;
  /*
   * Cabezal naranja; lo que va encima (título, iconos) en blanco. Es la
   * excepción a la paleta general: aquí los papeles van al revés —el naranja
   * hace de fondo y el verde de acento (el globo del carrito)— para que la
   * franja de arriba destaque sobre el resto de la pantalla.
   */
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
 * Cinta de iconos blanca a todo el ancho, pegada al borde de abajo. La columna
 * tiene altura fija y lo que desplaza es `.app-screen`, así que la cinta no se
 * va sola: solo sale de la pantalla cuando `.oculta` lo pide.
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
  box-shadow: 0 -4px 14px rgba(0, 0, 0, 0.06);
  transition:
    transform 0.24s ease,
    margin-bottom 0.24s ease;
}

/*
 * Bajando por el catálogo la cinta estorba. Se desliza fuera y además cede su
 * hueco con el margen negativo —justo su propio alto—, que es lo que deja a
 * `.app-screen` crecer; con solo el `translateY` quedaría una franja crema.
 */
.app-bottom-nav.oculta {
  transform: translateY(100%);
  margin-bottom: calc(-1 * var(--alto-nav, 0px));
}

@media (prefers-reduced-motion: reduce) {
  .app-bottom-nav {
    transition: none;
  }
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
