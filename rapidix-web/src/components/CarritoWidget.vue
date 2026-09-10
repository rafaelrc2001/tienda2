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
        <path d="M2.5 3.5h2.6l2.2 11.2a1.6 1.6 0 0 0 1.6 1.3h8.6a1.6 1.6 0 0 0 1.6-1.2l1.6-6.8H6" />
        <circle cx="9.5" cy="20" r="1.3" />
        <circle cx="17.5" cy="20" r="1.3" />
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
              <span class="puntos" aria-hidden="true" />
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

/* Mismo tamaño que la hamburguesa: el título queda centrado entre los dos. */
.carrito-btn {
  position: relative;
  width: 34px;
  height: 34px;
  border-radius: 11px;
  border: none;
  background: var(--white);
  box-shadow: var(--shadow);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink);
  cursor: pointer;
}

.carrito-btn.activo {
  color: var(--terracotta);
}

.carrito-btn svg {
  width: 19px;
  height: 19px;
}

.badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--terracotta);
  color: var(--white);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 10px;
  line-height: 17px;
  text-align: center;
  box-shadow: 0 0 0 2px var(--cream);
}

.overlay {
  position: absolute;
  inset: 0;
  background: rgba(20, 15, 8, 0.35);
  z-index: 1;
}

/* La forma es la del panel de repetir compra: esquinas cortas y renglones bajos. */
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
  border-radius: 6px;
  box-shadow: 0 12px 30px rgba(20, 15, 8, 0.25);
  font-family: var(--font-body);
  color: var(--ink);
  z-index: 2;
}

.panel-cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
}

.panel-titulo {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13.5px;
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
  padding: 5px 10px;
  font-size: 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
}

.lineas li.agotado {
  color: var(--muted);
  text-decoration: line-through;
}

.lineas .nombre {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* El «···» entre producto e importe. */
.lineas .puntos {
  flex: 1;
  min-width: 12px;
  border-bottom: 1px dotted var(--line);
  transform: translateY(-3px);
}

.lineas .importe {
  flex-shrink: 0;
}

.subtotal {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px 6px;
  font-weight: 700;
  font-size: 12px;
  text-transform: uppercase;
}

.subtotal .importe {
  font-size: 13.5px;
  color: var(--terracotta);
}

.acciones {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 6px 8px 8px;
}

.acciones button {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  border-radius: 4px;
  padding: 8px 6px;
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
}

.vaciar {
  background: var(--white);
  color: var(--ink);
  border: 1px solid var(--line);
}
</style>
