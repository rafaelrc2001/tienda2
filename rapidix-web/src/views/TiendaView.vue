<script setup lang="ts">
/**
 * Tienda (Word 4.3).
 *
 * Buscador, productos agrupados por categoría, control de cantidad en cada
 * tarjeta y barra flotante del carrito. Un producto agotado sale marcado y
 * ofrece "Programar" en vez del control de cantidad.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { http } from '@/api/http'
import { useCarritoStore } from '@/stores/carrito'
import { useUiStore } from '@/stores/ui'
import { dinero } from '@/utils/formato'
import SkeletonCard from '@/components/SkeletonCard.vue'
import type { CategoriaConProductos } from '@/api/tipos'

const carrito = useCarritoStore()
const ui = useUiStore()

const grupos = ref<CategoriaConProductos[]>([])
const cargando = ref(true)
const busqueda = ref('')
const programando = ref<string | null>(null)

/**
 * El filtrado se hace en el navegador sobre lo ya cargado.
 *
 * `GET /productos` acepta `?q=`, pero teclear no debe disparar una petición
 * por pulsación; el catálogo de una tienda cabe de sobra en memoria.
 */
const gruposVisibles = computed<CategoriaConProductos[]>(() => {
  const termino = busqueda.value.trim().toLowerCase()
  if (!termino) return grupos.value
  return grupos.value
    .map((g) => ({
      categoria: g.categoria,
      productos: g.productos.filter((p) => p.nombre.toLowerCase().includes(termino)),
    }))
    .filter((g) => g.productos.length > 0)
})

const hayResultados = computed(() => gruposVisibles.value.length > 0)

onMounted(async () => {
  try {
    grupos.value = await http.get<CategoriaConProductos[]>('/productos')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
  // El carrito puede venir de otra sesión: el total se recalcula al entrar.
  if (!carrito.vacio) await carrito.recalcular().catch(() => {})
})

// Cada cambio de cantidad vuelve a pedir el desglose a la API.
watch(
  () => carrito.lineas.map((l) => `${l.productoId}:${l.cantidad}`).join(','),
  () => {
    carrito.recalcular().catch(() => {})
  },
)

async function programar(productoId: string, nombre: string): Promise<void> {
  programando.value = productoId
  try {
    await http.post(`/productos/${productoId}/programar`)
    ui.exito(`Te avisaremos cuando ${nombre} vuelva a estar disponible.`)
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    programando.value = null
  }
}
</script>

<template>
  <div class="tienda">
    <div class="search-bar">
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
        <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <input v-model="busqueda" type="search" placeholder="Buscar productos en la tienda..." />
    </div>

    <SkeletonCard v-if="cargando" />

    <template v-else-if="hayResultados">
      <section v-for="grupo in gruposVisibles" :key="grupo.categoria" class="store-cat-block">
        <h2 class="section-title"><span class="accent-bar" />{{ grupo.categoria }}</h2>

        <div class="product-grid">
          <article
            v-for="producto in grupo.productos"
            :key="producto.id"
            class="product-card"
            :class="{ 'is-agotado': producto.agotado }"
          >
            <span v-if="producto.agotado" class="agotado-ribbon">Agotado</span>

            <div class="product-media">
              <img v-if="producto.imagenUrl" :src="producto.imagenUrl" :alt="producto.nombre" />
              <template v-else>{{ producto.emoji ?? '🛒' }}</template>
            </div>

            <p class="product-name">{{ producto.nombre }}</p>
            <p class="product-unit">{{ producto.unidad }}</p>
            <p class="product-price">{{ dinero(producto.precioVenta) }}</p>

            <button
              v-if="producto.agotado"
              type="button"
              class="btn-secondary programar"
              :disabled="programando === producto.id"
              @click="programar(producto.id, producto.nombre)"
            >
              {{ programando === producto.id ? 'Enviando…' : 'Programar' }}
            </button>

            <div v-else-if="carrito.cantidadDe(producto.id) > 0" class="qty-control">
              <button type="button" aria-label="Quitar uno" @click="carrito.quitar(producto.id)">
                −
              </button>
              <span class="qn">{{ carrito.cantidadDe(producto.id) }}</span>
              <button type="button" aria-label="Añadir uno" @click="carrito.agregar(producto.id)">
                +
              </button>
            </div>

            <button
              v-else
              type="button"
              class="add-cart-btn"
              aria-label="Añadir al carrito"
              @click="carrito.agregar(producto.id)"
            >
              +
            </button>
          </article>
        </div>
      </section>
    </template>

    <p v-else-if="busqueda" class="empty-block">
      No encontramos productos que coincidan con «{{ busqueda }}».
    </p>
    <p v-else class="empty-block">Todavía no hay productos en la tienda.</p>

    <!-- Barra del carrito: el importe lo da la API, no se suma aquí. -->
    <RouterLink v-if="!carrito.vacio" to="/carrito" class="cart-bar">
      <span class="txt">
        Ver carrito · {{ carrito.totalPiezas }}
        {{ carrito.totalPiezas === 1 ? 'producto' : 'productos' }}
      </span>
      <span class="amt">
        {{ carrito.previsualizacion ? dinero(carrito.previsualizacion.total) : '…' }}
      </span>
    </RouterLink>
  </div>
</template>

<style scoped>
.tienda {
  position: relative;
}

.search-bar {
  margin: 6px 18px 12px;
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

.store-cat-block {
  margin-bottom: 6px;
}

.product-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  padding: 0 18px 8px;
}

.product-card {
  background: var(--white);
  border-radius: 16px;
  padding: 12px;
  box-shadow: var(--shadow);
  position: relative;
  overflow: hidden;
}

.product-card.is-agotado {
  opacity: 0.85;
}

.product-card.is-agotado .product-media {
  filter: grayscale(45%);
  opacity: 0.75;
}

.agotado-ribbon {
  position: absolute;
  top: 12px;
  right: -30px;
  width: 120px;
  transform: rotate(40deg);
  text-align: center;
  background: var(--terracotta);
  color: var(--white);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 9px;
  letter-spacing: 0.06em;
  padding: 3px 0;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  z-index: 2;
  text-transform: uppercase;
  pointer-events: none;
}

.product-media {
  height: 70px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 38px;
  background: var(--cream-2);
  border-radius: 12px;
  margin-bottom: 8px;
  overflow: hidden;
}

.product-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.product-name {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.25;
  min-height: 30px;
  margin: 0;
}

.product-unit {
  font-size: 10px;
  color: var(--muted);
  margin: 1px 0 0;
  font-weight: 600;
}

.product-price {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 14px;
  color: var(--terracotta-dark);
  margin: 4px 0 0;
}

.add-cart-btn {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--gold);
  border: 1.5px solid var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-weight: 800;
  font-size: 15px;
  color: var(--ink);
  line-height: 1;
}

.qty-control {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  margin-top: 8px;
}

.qty-control button {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 1.5px solid var(--line);
  background: var(--cream);
  font-weight: 800;
  font-size: 14px;
  cursor: pointer;
  color: var(--ink);
}

.qty-control .qn {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  min-width: 16px;
  text-align: center;
}

.programar {
  width: 100%;
  margin-top: 8px;
  font-size: 11.5px;
  padding: 8px 6px;
}

.cart-bar {
  position: sticky;
  bottom: 8px;
  margin: 14px 18px 4px;
  background: var(--navy);
  color: var(--white);
  border-radius: 16px;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  box-shadow: var(--shadow);
  cursor: pointer;
  z-index: 5;
  text-decoration: none;
}

.cart-bar .txt {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
}

.cart-bar .amt {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 15px;
  color: var(--gold);
}
</style>
