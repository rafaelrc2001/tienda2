<script setup lang="ts">
/**
 * Tienda: el catálogo ordenado a la medida del cliente (HU-01 a HU-15).
 *
 * Tres bloques, de arriba abajo:
 *
 *  1. **Repetir la última compra**, si la hay, y debajo el buscador. Se pliega
 *     al bajar.
 *  2. **Una fila por familia**, en el orden que devuelve la API. La pantalla
 *     no reordena nada: el criterio vive en el backend, que es el único que
 *     sabe qué ha comprado esta persona.
 *  3. **Barra de compra** pegada abajo con lo que suman los productos, el
 *     cashback que dejaría el pedido y lo que le falta para el envío gratis.
 *
 * Se puede mirar sin sesión (HU-02): el visitante ve el catálogo del negocio y
 * puede armar su carrito; el login se le pide al pulsar «Comprar ahora».
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { http } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { useCarritoStore } from '@/stores/carrito'
import { useUiStore } from '@/stores/ui'
import { dinero } from '@/utils/formato'
import SkeletonCard from '@/components/SkeletonCard.vue'
import CarruselFamilia from '@/components/tienda/CarruselFamilia.vue'
import PanelUltimoPedido from '@/components/tienda/PanelUltimoPedido.vue'
import type { CatalogoRecomendado, FamiliaRecomendada, UltimoPedido } from '@/api/tipos'

/** Lo que hay que bajar para que el bloque de repetir compra se pliegue. */
const SCROLL_PARA_PLEGAR = 60

const router = useRouter()
const auth = useAuthStore()
const carrito = useCarritoStore()
const ui = useUiStore()

const raiz = ref<HTMLElement | null>(null)

const catalogo = ref<CatalogoRecomendado | null>(null)
const cargando = ref(true)
/** La API falló: es distinto de «no hay productos» (HU-15). */
const fallo = ref(false)
const busqueda = ref('')
const programando = ref<string | null>(null)

const ultimoPedido = ref<UltimoPedido | null>(null)
/** El cliente dijo «no, crear uno nuevo»: no vuelve en esta visita. */
const descartado = ref(false)
const plegado = ref(false)
const repitiendo = ref(false)

/**
 * El filtrado se hace en el navegador sobre lo ya cargado.
 *
 * Teclear no debe disparar una petición por pulsación, y el catálogo de una
 * tienda cabe de sobra en memoria. Buscar deja fuera las familias sin
 * coincidencias, pero **no reordena**: el orden sigue siendo el que dio la API.
 */
const familiasVisibles = computed<FamiliaRecomendada[]>(() => {
  const familias = catalogo.value?.familias ?? []
  const termino = busqueda.value.trim().toLowerCase()
  if (!termino) return familias

  return familias
    .map((familia) => ({
      ...familia,
      productos: familia.productos.filter((p) => p.nombre.toLowerCase().includes(termino)),
    }))
    .filter((familia) => familia.productos.length > 0)
})

const hayResultados = computed(() => familiasVisibles.value.length > 0)
const controlInventario = computed(() => catalogo.value?.controlInventario ?? false)

/** Todos los productos cargados, por id: hace falta para topar cantidades. */
const productosPorId = computed(() => {
  const mapa = new Map<string, { aptInventario: number }>()
  for (const familia of catalogo.value?.familias ?? []) {
    for (const producto of familia.productos) mapa.set(producto.id, producto)
  }
  return mapa
})

const mostrarFastTrack = computed(
  () => ultimoPedido.value !== null && !descartado.value && busqueda.value.trim() === '',
)

const cashback = computed(() => carrito.cashbackEstimado ?? 0)

/**
 * Lo que le falta al carrito, para decirlo aquí y no solo en el carrito
 * (HU-20). Llega calculado de la API; con el carrito vacío no hay nada que
 * medir y la barra no dice nada.
 */
const metas = computed(() => (carrito.vacio ? null : carrito.metas))

onMounted(async () => {
  await Promise.all([cargarCatalogo(), cargarUltimoPedido()])

  // El carrito puede venir de otra sesión o de otro día: el importe se
  // recalcula al entrar, nunca se da por bueno el que estaba en pantalla.
  if (!carrito.vacio) await carrito.refrescarImporte().catch(() => {})

  escucharDesplazamiento()
})

onBeforeUnmount(() => {
  contenedor?.removeEventListener('scroll', alDesplazar)
})

async function cargarCatalogo(): Promise<void> {
  cargando.value = true
  fallo.value = false
  try {
    catalogo.value = await http.get<CatalogoRecomendado>('/productos/recomendados')
  } catch {
    // El motivo no se enseña como toast: la pantalla entera se queda sin
    // catálogo, así que el mensaje va en el sitio donde debería estar.
    fallo.value = true
  } finally {
    cargando.value = false
  }
}

/** Solo un cliente tiene pedidos que repetir; el visitante no pide nada. */
async function cargarUltimoPedido(): Promise<void> {
  if (!auth.autenticado || !auth.esCliente) return
  try {
    ultimoPedido.value = await http.get<UltimoPedido | null>('/pedidos/ultimo')
  } catch {
    ultimoPedido.value = null
  }
}

// Cada cambio de cantidad vuelve a pedir el importe a la API.
watch(
  () => carrito.lineas.map((l) => `${l.productoId}:${l.cantidad}`).join(','),
  () => {
    carrito.refrescarImporte().catch(() => {})
  },
)

// ------------------------------------------------------------------
// Plegado del bloque de repetir compra (HU-05)
// ------------------------------------------------------------------

/**
 * Quien desplaza es `.app-screen`, no la ventana: el marco de la aplicación
 * tiene altura fija y el contenido se mueve dentro. Escuchar en `window` aquí
 * no recibiría ni un evento.
 */
let contenedor: HTMLElement | null = null

function alDesplazar(): void {
  if (!contenedor) return
  plegado.value = contenedor.scrollTop > SCROLL_PARA_PLEGAR
}

function escucharDesplazamiento(): void {
  contenedor = raiz.value?.closest('.app-screen') as HTMLElement | null
  contenedor?.addEventListener('scroll', alDesplazar, { passive: true })
}

/** Tocar un carrusel también lo pliega: se está mirando el catálogo. */
function alTocarCarrusel(): void {
  plegado.value = true
}

/**
 * «Sí, usar este pedido»: el carrito pasa a ser exactamente aquel pedido.
 *
 * Se reemplaza lo que hubiera en el carrito en vez de sumarlo. «Usar este
 * pedido» significa ese pedido, y sumar cantidades a lo que ya había daría un
 * carrito que no es ni lo uno ni lo otro.
 */
async function repetirPedido(): Promise<void> {
  const pedido = ultimoPedido.value
  if (!pedido) return

  repitiendo.value = true
  try {
    carrito.vaciar()
    for (const item of pedido.items) {
      if (!item.disponible) continue
      const tope = controlInventario.value
        ? productosPorId.value.get(item.productoId)?.aptInventario
        : undefined
      carrito.fijarCantidad(item.productoId, item.cantidad, tope)
    }

    if (carrito.vacio) {
      ui.error('Ningún producto de ese pedido está disponible ahora mismo.');
      return
    }

    await carrito.refrescarImporte().catch(() => {})
    await router.push('/carrito')
  } finally {
    repitiendo.value = false
  }
}

// ------------------------------------------------------------------
// Acciones del catálogo
// ------------------------------------------------------------------

async function programar(productoId: string, nombre: string): Promise<void> {
  if (!auth.autenticado) {
    await router.push({ path: '/login', query: { destino: '/tienda' } })
    return
  }

  programando.value = productoId
  try {
    await http.post(`/productos/${productoId}/programar`)
    ui.exito(`Te avisaremos cuando ${nombre} vuelva a estar disponible.`)
  } catch (error) {
    ui.errorDeApi(error)
  } finally {
    programando.value = null
  }
}

/**
 * «Comprar ahora».
 *
 * Sin sesión no se pierde nada: el carrito ya está guardado en el navegador y
 * se recupera al volver del login (HU-14).
 */
async function comprarAhora(): Promise<void> {
  if (carrito.vacio) return
  if (!auth.autenticado) {
    await router.push({ path: '/login', query: { destino: '/tienda' } })
    return
  }
  await router.push('/carrito')
}
</script>

<template>
  <div ref="raiz" class="tienda">
    <PanelUltimoPedido
      v-if="mostrarFastTrack && ultimoPedido"
      :pedido="ultimoPedido"
      :colapsado="plegado"
      :ocupado="repitiendo"
      @usar="repetirPedido"
      @descartar="descartado = true"
      @expandir="plegado = false"
      @contraer="plegado = true"
    />

    <div class="search-bar">
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
        <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <input v-model="busqueda" type="search" placeholder="Buscar productos en la tienda..." />
    </div>

    <SkeletonCard v-if="cargando" />

    <p v-else-if="fallo" class="empty-block">
      Error al cargar productos.
      <button type="button" class="reintentar" @click="cargarCatalogo">Reintentar</button>
    </p>

    <template v-else-if="hayResultados">
      <CarruselFamilia
        v-for="familia in familiasVisibles"
        :key="familia.categoria"
        :familia="familia"
        :control-inventario="controlInventario"
        @programar="programar"
        @interaccion="alTocarCarrusel"
      />
    </template>

    <p v-else-if="busqueda" class="empty-block">
      No encontramos productos que coincidan con «{{ busqueda }}».
    </p>
    <p v-else class="empty-block">No hay productos disponibles.</p>

    <!-- Barra de compra: el importe lo da la API, no se suma aquí. -->
    <div class="barra-compra pegada-al-nav">
      <div v-if="cashback > 0 || metas?.faltaCashback || metas?.faltaEnvioGratis" class="chips">
        <span v-if="cashback > 0" class="chip chip-cashback">
          Ganas {{ dinero(cashback) }} de cashback
        </span>
        <span v-else-if="metas?.faltaCashback" class="chip chip-meta">
          ¡Estás a solo {{ dinero(metas.faltaCashback) }} de activar tu cashback!
        </span>
        <span v-if="metas?.faltaEnvioGratis" class="chip chip-meta">
          Te faltan {{ dinero(metas.faltaEnvioGratis) }} para envío gratis
        </span>
      </div>

      <button
        type="button"
        class="comprar"
        :disabled="carrito.vacio"
        @click="comprarAhora"
      >
        Comprar ahora<template v-if="!carrito.vacio">:
          <span class="amt">
            {{ carrito.subtotal !== null ? dinero(carrito.subtotal) : '…' }}
          </span>
        </template>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tienda {
  position: relative;
}

.search-bar {
  margin: 2px 18px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--white);
  border-radius: 16px;
  padding: 11px 14px;
  box-shadow: var(--shadow);
}

.search-bar input {
  border: none;
  outline: none;
  flex: 1;
  min-width: 0;
  font-family: var(--font-body);
  font-size: 13.5px;
  background: transparent;
  color: var(--ink);
}

.search-bar svg {
  width: 16px;
  height: 16px;
  color: var(--muted);
  flex-shrink: 0;
}

.reintentar {
  display: block;
  margin: 10px auto 0;
  border: 1.5px solid var(--line);
  background: var(--white);
  color: var(--ink);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11.5px;
  border-radius: 9px;
  padding: 7px 14px;
  cursor: pointer;
}

/*
 * La barra se queda pegada abajo mientras se recorre el catálogo. Los chips van
 * encima del botón: el del cashback aparece al cruzar el mínimo que fija el
 * negocio (HU-12) y, antes, el aviso de cuánto falta; el del envío gratis se va
 * en cuanto se alcanza.
 *
 * Va pegada a la barra inferior, sin hueco: `bottom: 0` y el mismo margen
 * lateral que el menú (8px). `pegada-al-nav` le dice al layout que quite el
 * colchón inferior de `.app-screen` (el sticky respeta ese padding y dejaba
 * 18px de hueco) y que aplane el menú por arriba.
 */
.barra-compra {
  position: sticky;
  bottom: 0;
  margin: 14px 8px 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  z-index: 5;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 5px;
}

.chip {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 10.5px;
  padding: 5px 11px;
  border-radius: 999px;
  box-shadow: var(--shadow);
  color: var(--ink);
}

.chip-cashback {
  background: var(--gold);
}

/* Lo que falta es un empujón, no un logro: sin dorado. */
.chip-meta {
  background: var(--white);
  border: 1.5px solid var(--gold);
}

/*
 * Barra plana de una sola línea, «Comprar ahora: $X», como la del ecommerce
 * anterior: texto centrado, navy y dorado de Rapidix. Redondeada solo arriba:
 * por abajo continúa en el menú y los dos se leen como un solo bloque.
 */
.comprar {
  width: 100%;
  background: var(--navy);
  color: var(--white);
  border: none;
  border-radius: 16px 16px 0 0;
  padding: 11px 16px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.2px;
  text-align: center;
  cursor: pointer;
}

.comprar:disabled {
  opacity: 0.5;
  cursor: default;
}

.comprar .amt {
  font-weight: 800;
  color: var(--gold);
}
</style>
