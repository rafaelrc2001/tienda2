<script setup lang="ts">
/**
 * Administración → PDV: el punto de venta de **una** tienda.
 *
 * Lo primero es elegir la tienda, siempre que se entra: cada una tiene su
 * turno, su inventario y sus cortes, y todo lo que se ve después es solo de
 * la elegida. Va en la URL (`?tienda=`) para que cambiar de pestaña o
 * recargar no la pierda; entrar desde el menú llega sin ella y vuelve a
 * preguntar. «Cambiar de tienda» regresa a la lista.
 *
 * Con la tienda elegida, cinco pestañas:
 *
 *  - **Punto de Venta**: el turno del cajero en esa tienda y su caja. Los
 *    pedidos se capturan, se entregan y se cobran ahí mismo.
 *  - **Inventario**: lo que bodega le mandó a la tienda —que aquí se acepta—
 *    y lo que la tienda tiene.
 *  - **Corte de caja**: el total de los pedidos del turno, y su cierre.
 *  - **Operaciones**: los pedidos de la app que el cliente eligió recoger en
 *    esta tienda, que aquí se preparan y se entregan. Lleva una campana con
 *    cuántos faltan por preparar —el mismo globo del carrito—, para que quien
 *    está cobrando se entere de que entró uno sin tener que abrirla. El aviso
 *    va solo aquí, ya dentro de la tienda: la lista de tiendas no lo enseña.
 *  - **Facturación**: los pedidos de la tienda sin factura, que aquí se
 *    facturan uno por uno o varios juntos con la razón social que se elija, y
 *    las facturas que ya tienen.
 *
 * Como en Rutas, la pestaña va en la URL y cada una se vuelve a montar —y a
 * pedir sus datos— en cada toque: así nunca enseña datos viejos.
 *
 * `pantalla-pdv` le pide al layout una columna más ancha que la del resto del
 * panel: el catálogo de la caja aprovecha el ancho.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ErrorApi, http } from '@/api/http'
import SkeletonList from '@/components/SkeletonList.vue'
import SelectorTienda from './pdv/SelectorTienda.vue'
import VentanaInventarioTienda from './pdv/VentanaInventarioTienda.vue'
import VentanaPuntoDeVenta from './pdv/VentanaPuntoDeVenta.vue'
import VentanaCorteDeCaja from './pdv/VentanaCorteDeCaja.vue'
import VentanaOperacionesTienda from './pdv/VentanaOperacionesTienda.vue'
import VentanaFacturacionTienda from './pdv/VentanaFacturacionTienda.vue'
import type { PendientesPorTienda, Tienda } from '@/api/tipos'

type Ventana = 'pdv' | 'inventario' | 'corte' | 'operaciones' | 'facturacion'

const VENTANAS: { id: Ventana; titulo: string }[] = [
  { id: 'pdv', titulo: 'Punto de Venta' },
  { id: 'inventario', titulo: 'Inventario' },
  { id: 'corte', titulo: 'Corte de caja' },
  { id: 'operaciones', titulo: 'Operaciones' },
  { id: 'facturacion', titulo: 'Facturación' },
]

/** Cada cuánto se vuelve a preguntar si entró un pedido para recoger. */
const SONDEO_PENDIENTES_MS = 60_000

const route = useRoute()
const router = useRouter()

const tiendas = ref<Tienda[]>([])
const cargando = ref(true)
const error = ref('')

/**
 * Pedidos para recoger que cada tienda no ha terminado de preparar. Los cuenta
 * la API; aquí solo se pinta la campana de la tienda elegida.
 */
const pendientes = ref<PendientesPorTienda>({})

/**
 * Es un aviso: si falla se queda lo último que se supo, sin toast. Un error de
 * red cada minuto encima de la caja estorbaría más de lo que avisa.
 */
async function contarPendientes(): Promise<void> {
  try {
    pendientes.value = await http.get<PendientesPorTienda>('/admin/pdv/operaciones/pendientes')
  } catch {
    // Se reintenta en el siguiente sondeo o al tocar una pestaña.
  }
}

let sondeo: ReturnType<typeof setInterval> | undefined

onBeforeUnmount(() => clearInterval(sondeo))

onMounted(async () => {
  void contarPendientes()
  sondeo = setInterval(() => void contarPendientes(), SONDEO_PENDIENTES_MS)
  try {
    tiendas.value = await http.get<Tienda[]>('/admin/pdv/tiendas')
  } catch (fallo) {
    error.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos cargar las tiendas.'
  } finally {
    cargando.value = false
  }
})

/** La tienda de la URL, si existe y sigue activa. Sin ella se pregunta. */
const tienda = computed<Tienda | null>(
  () => tiendas.value.find((t) => t.id === route.query.tienda) ?? null,
)

const ventana = computed<Ventana>(() => {
  const pedida = route.query.ventana
  return VENTANAS.some((v) => v.id === pedida) ? (pedida as Ventana) : 'pdv'
})

/** Sube con cada toque de pestaña: cambia la `key` y la pestaña se vuelve a montar. */
const vuelta = ref(0)

function elegir(elegida: Tienda): void {
  void router.push({ query: { tienda: elegida.id } })
}

function cambiarDeTienda(): void {
  void router.push({ query: {} })
}

/** Lo que la tienda elegida tiene por preparar: el número de la campana. */
const porPreparar = computed(() => (tienda.value ? (pendientes.value[tienda.value.id] ?? 0) : 0))

/**
 * La fila de pestañas se desliza de lado en un teléfono: al entrar con una
 * pestaña de la URL (p. ej. Facturación) o al tocar una medio cortada en el
 * borde, se recorre la fila hasta dejarla entera a la vista. Se mueve solo
 * `scrollLeft` de la fila: `scrollIntoView` arrastraría también el scroll
 * vertical de `.app-screen`.
 */
const filaPestanas = ref<HTMLElement | null>(null)

function mostrarPestanaActiva(): void {
  const fila = filaPestanas.value
  const activa = fila?.querySelector<HTMLElement>('.subtab.active')
  if (!fila || !activa) return
  const margen = 5
  const izquierda = activa.offsetLeft - margen
  const derecha = activa.offsetLeft + activa.offsetWidth + margen - fila.clientWidth
  if (fila.scrollLeft > izquierda) fila.scrollTo({ left: izquierda, behavior: 'smooth' })
  else if (fila.scrollLeft < derecha) fila.scrollTo({ left: derecha, behavior: 'smooth' })
}

watch([ventana, filaPestanas], () => void nextTick(mostrarPestanaActiva))

function abrir(id: Ventana): void {
  vuelta.value++
  void contarPendientes()
  if (id !== ventana.value && tienda.value) {
    void router.replace({
      query: { tienda: tienda.value.id, ...(id !== 'pdv' && { ventana: id }) },
    })
  }
}
</script>

<template>
  <div class="pantalla pantalla-pdv sin-colchon">
    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <SkeletonList v-if="cargando" :cantidad="3" />

    <p v-else-if="error" class="form-error">{{ error }}</p>

    <SelectorTienda v-else-if="!tienda" :tiendas="tiendas" @elegir="elegir" />

    <template v-else>
      <div class="tienda-actual">
        <p>
          <span class="nombre">{{ tienda.nombre }}</span>
          <span class="datos">{{ tienda.direccion }} · {{ tienda.responsable }}</span>
        </p>
        <button type="button" @click="cambiarDeTienda">Cambiar de tienda</button>
      </div>

      <div ref="filaPestanas" class="subtab-row" role="tablist" aria-label="Punto de Venta">
        <button
          v-for="v in VENTANAS"
          :key="v.id"
          type="button"
          role="tab"
          class="subtab"
          :class="{ active: ventana === v.id }"
          :aria-selected="ventana === v.id"
          :aria-controls="`ventana-${v.id}`"
          @click="abrir(v.id)"
        >
          <!-- La campana solo aparece si hay algo que preparar. Va antes del rótulo:
               a la derecha era lo primero que se recortaba en un teléfono. -->
          <span
            v-if="v.id === 'operaciones' && porPreparar > 0"
            class="campana"
            :aria-label="`${porPreparar} pedido(s) por preparar`"
            :title="`${porPreparar} pedido(s) por preparar`"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path
                d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="globo">{{ porPreparar }}</span>
          </span>
          <span class="rotulo">{{ v.titulo }}</span>
        </button>
      </div>

      <!-- La `key` lleva la tienda: al cambiar de tienda no queda nada de la anterior. -->
      <div :id="`ventana-${ventana}`" role="tabpanel">
        <VentanaInventarioTienda
          v-if="ventana === 'inventario'"
          :key="`inventario-${tienda.id}-${vuelta}`"
          :tienda="tienda"
        />
        <VentanaPuntoDeVenta
          v-else-if="ventana === 'pdv'"
          :key="`pdv-${tienda.id}-${vuelta}`"
          :tienda="tienda"
        />
        <VentanaOperacionesTienda
          v-else-if="ventana === 'operaciones'"
          :key="`operaciones-${tienda.id}-${vuelta}`"
          :tienda="tienda"
          :por-preparar="porPreparar"
          @cambio="contarPendientes"
        />
        <VentanaFacturacionTienda
          v-else-if="ventana === 'facturacion'"
          :key="`facturacion-${tienda.id}-${vuelta}`"
          :tienda="tienda"
        />
        <VentanaCorteDeCaja v-else :key="`corte-${tienda.id}-${vuelta}`" :tienda="tienda" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.pantalla {
  padding: 12px 18px 0;
}

.admin-back-inline {
  display: inline-block;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  padding: 0 0 8px;
  text-decoration: none;
}

.tienda-actual {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: var(--white);
  border-radius: 12px;
  box-shadow: var(--shadow);
  padding: 9px 14px;
  margin-bottom: 10px;
}

.tienda-actual p {
  margin: 0;
  min-width: 0;
}

.tienda-actual .nombre {
  display: block;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 14px;
  color: var(--ink);
}

.tienda-actual .datos {
  display: block;
  font-size: 11px;
  color: var(--muted);
}

.tienda-actual button {
  flex-shrink: 0;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--white);
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11.5px;
  padding: 7px 12px;
  cursor: pointer;
}

.subtab-row {
  margin: 0 0 12px;
}

/* Son cinco pestañas y en un teléfono no caben: recortadas a «Invent…» o
   «Factura…» no se leían. En vez de encogerlas, la fila se desliza hacia los
   lados con el dedo; cada pestaña mide lo que ocupa su rótulo completo y, si en
   pantalla ancha sobra sitio, se lo reparten. La barra de scroll se oculta: la
   pestaña cortada en el borde ya avisa de que hay más. */
.subtab-row {
  /* `relative` para que el `offsetLeft` de cada pestaña se mida desde la fila. */
  position: relative;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-snap-type: x proximity;
  scroll-padding: 0 5px;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.subtab-row::-webkit-scrollbar {
  display: none;
}

.subtab-row .subtab {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 0 auto;
  padding-left: 14px;
  padding-right: 14px;
  scroll-snap-align: start;
}

/* La campana toma el color del texto de la pestaña; el número va encima, en el
   mismo globo verde del carrito. El margen derecho le deja sitio al globo, que
   sobresale, antes de que empiece el rótulo. */
.campana {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  margin: 0 12px 0 2px;
}

.globo {
  position: absolute;
  top: -7px;
  left: 8px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--verde);
  color: var(--white);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 9.5px;
  line-height: 15px;
  text-align: center;
  /* El aro del color de la pestaña lo despega de la campana. */
  box-shadow: 0 0 0 2px var(--cream-2);
}

.subtab.active .globo {
  box-shadow: 0 0 0 2px var(--terracotta);
}
</style>
