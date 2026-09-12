<script setup lang="ts">
/**
 * Widget «Mi carrito» del header (HU-01 a HU-06).
 *
 * El ícono lleva las piezas, no los productos: 3 Urea + 2 Glifosato son 5. Un
 * toque abre el desplegable encima de la pantalla actual y otro lo cierra; no
 * se cambia de página hasta que el cliente pulsa «Ver resumen →».
 *
 * Los importes salen de la API como en el resto de la app: precio escalonado
 * por cantidad y subtotal solo de productos, sin envío ni cashback.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useCarritoStore } from '@/stores/carrito'
import { dinero } from '@/utils/formato'

const auth = useAuthStore()
const carrito = useCarritoStore()
const route = useRoute()
const router = useRouter()

const abierto = ref(false)
const vaciando = ref(false)

/** Hay piezas pero la API aún no las valoró: «Cargando...». */
const lineas = computed(() => carrito.lineasValoradas)
const cargando = computed(() => !carrito.vacio && lineas.value.length === 0)

function alternar(): void {
  abierto.value = !abierto.value
}

function cerrar(): void {
  abierto.value = false
}

// Al abrir se pide el importe de nuevo: el carrito pudo cambiar en otra
// pantalla o venir guardado de otro día.
watch(abierto, (si) => {
  if (si && !carrito.vacio) carrito.refrescarImporte().catch(() => {})
})

// Cambiar de página por otro camino (barra de abajo, atrás) lo cierra.
watch(() => route.fullPath, cerrar)

function alPulsarTecla(evento: KeyboardEvent): void {
  if (evento.key === 'Escape') cerrar()
}

onMounted(() => window.addEventListener('keydown', alPulsarTecla))
onBeforeUnmount(() => window.removeEventListener('keydown', alPulsarTecla))

/**
 * «Ver resumen →». Sin sesión se pide el login primero; el carrito ya está
 * guardado en el navegador y sigue ahí al volver (HU-14).
 */
async function verResumen(): Promise<void> {
  if (carrito.vacio) return
  cerrar()
  if (!auth.autenticado) {
    await router.push({ path: '/login', query: { destino: '/carrito' } })
    return
  }
  await router.push('/carrito')
}

/**
 * «Vaciar carrito». El cliente se queda donde está, salvo en el resumen: un
 * resumen vacío no sirve de nada y lo mandamos a la Tienda.
 */
async function vaciar(): Promise<void> {
  vaciando.value = true
  try {
    await carrito.vaciarAhora()
  } finally {
    vaciando.value = false
  }
  if (route.path === '/carrito') {
    cerrar()
    await router.push('/tienda')
  }
}
</script>

<template>
  <div class="carrito-widget">
    <button
      type="button"
      class="carrito-btn"
      :class="{ activo: abierto }"
      :aria-expanded="abierto"
      :aria-label="carrito.vacio ? 'Mi carrito' : `Mi carrito, ${carrito.totalPiezas} piezas`"
      @click="alternar"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
      </svg>
      <span v-if="carrito.totalPiezas > 0" class="badge">{{ carrito.totalPiezas }}</span>
    </button>

    <template v-if="abierto">
      <div class="overlay" @click="cerrar" />

      <section class="panel" role="dialog" aria-label="Mi carrito">
        <header class="panel-cabecera">
          <span class="panel-titulo">Mi carrito</span>
          <button type="button" class="cerrar" aria-label="Cerrar" @click="cerrar">✕</button>
        </header>

        <p v-if="carrito.vacio" class="mensaje">El carrito está vacío</p>
        <p v-else-if="cargando" class="mensaje">Cargando...</p>

        <template v-else>
          <ul class="lineas">
            <li v-for="linea in lineas" :key="linea.productoId" :class="{ agotado: linea.agotado }">
              <span class="nombre">{{ linea.cantidad }}× {{ linea.nombre }}</span>
              <span class="importe">{{ dinero(linea.importe) }}</span>
            </li>
          </ul>

          <div class="subtotal">
            <span>Subtotal</span>
            <span class="importe">
              {{ carrito.subtotal !== null ? dinero(carrito.subtotal) : '…' }}
            </span>
          </div>
        </template>

        <div class="acciones">
          <button type="button" class="ver" :disabled="carrito.vacio" @click="verResumen">
            Ver resumen →
          </button>
          <button
            type="button"
            class="vaciar"
            :disabled="carrito.vacio || vaciando"
            @click="vaciar"
          >
            {{ vaciando ? 'Vaciando…' : 'Vaciar carrito' }}
          </button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
/*
 * Sin `position`: el overlay y el panel se colocan contra `.app-column`, así
 * cubren toda la columna de la app y no solo el header.
 */
.carrito-widget {
  flex-shrink: 0;
}

/*
 * Mismo ancho que la hamburguesa (el título queda centrado entre los dos),
 * pero sin caja: el carrito suelto de línea como en el diseño anterior.
 */
.carrito-btn {
  position: relative;
  width: 34px;
  height: 34px;
  border: none;
  background: transparent;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  /*
   * Hereda el blanco del cabezal verde, también con productos: lo que se
   * lleva ya lo dice el globo naranja.
   */
  color: inherit;
  cursor: pointer;
}

.carrito-btn svg {
  width: 26px;
  height: 26px;
}

.badge {
  position: absolute;
  top: -3px;
  right: -6px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 999px;
  /* Verde de notificación sobre el cabezal naranja; el aro del color del cabezal lo despega del ícono. */
  background: var(--verde);
  color: var(--white);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 10px;
  line-height: 17px;
  text-align: center;
  box-shadow: 0 0 0 2px var(--orange);
}

.overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 1;
}

/* Distribución del diseño anterior: lista, subtotal, acción principal y vaciar como enlace. */
.panel {
  position: absolute;
  top: 54px;
  right: 12px;
  width: min(320px, calc(100% - 24px));
  max-height: calc(100% - 70px);
  display: flex;
  flex-direction: column;
  background: var(--white);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
  font-family: var(--font-body);
  color: var(--ink);
  z-index: 2;
}

.panel-cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
}

.panel-titulo {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 14px;
}

.cerrar {
  border: none;
  background: transparent;
  font-size: 14px;
  color: var(--muted);
  cursor: pointer;
  padding: 2px 4px;
}

.mensaje {
  margin: 0;
  padding: 18px 10px;
  text-align: center;
  font-size: 12.5px;
  color: var(--muted);
}

.lineas {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
}

.lineas li {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 7px 14px;
  font-size: 12.5px;
}

.lineas li.agotado {
  color: var(--muted);
  text-decoration: line-through;
}

.lineas .nombre {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lineas .importe {
  flex-shrink: 0;
}

.subtotal {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--line);
  font-weight: 700;
  font-size: 13px;
}

.subtotal .importe {
  font-size: 13.5px;
  color: var(--terracotta);
}

/* Como el diseño anterior: la acción principal a todo el ancho y vaciar como enlace debajo. */
.acciones {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 4px 14px 10px;
}

.acciones button {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
}

.acciones button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ver {
  background: var(--navy);
  color: var(--white);
  border: 1px solid var(--navy);
  border-radius: 6px;
  padding: 10px 8px;
}

.vaciar {
  align-self: center;
  background: transparent;
  color: var(--terracotta);
  border: none;
  padding: 6px 8px;
}
</style>
