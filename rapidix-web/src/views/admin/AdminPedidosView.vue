<script setup lang="ts">
/**
 * Administración → Pedidos: historial completo de la plataforma.
 *
 * `GET /admin/pedidos` acepta `?limite=` con tope 500 en el backend.
 */
import { computed, onMounted, ref } from 'vue'
import { http } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import {
  dinero,
  fechaHora,
  nombreEstadoPago,
  nombreEstadoPedido,
  nombreMetodoPago,
} from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import type { Pedido } from '@/api/tipos'

const ui = useUiStore()
const auth = useAuthStore()

/** Validar transferencias es de Finanzas: la API lo exige con esa sección (HU-11). */
const puedeValidarPagos = computed(() => auth.puedeVer('finanzas'))
const validando = ref<string | null>(null)

async function validarPago(pedido: Pedido): Promise<void> {
  validando.value = pedido.id
  try {
    const actualizado = await http.patch<Pedido>(`/admin/pedidos/${pedido.id}/pago`)
    pedidos.value = pedidos.value.map((p) => (p.id === actualizado.id ? actualizado : p))
    ui.exito(`Pago de ${pedido.folio} validado`)
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    validando.value = null
  }
}

const pedidos = ref<Pedido[]>([])
const cargando = ref(true)
const busqueda = ref('')
const limite = ref(100)

/** El filtro es local: la API no acepta `?q=` en este endpoint. */
const visibles = computed(() => {
  const termino = busqueda.value.trim().toLowerCase()
  if (!termino) return pedidos.value
  return pedidos.value.filter(
    (p) =>
      p.folio.toLowerCase().includes(termino) ||
      (p.clienteNombre ?? '').toLowerCase().includes(termino) ||
      nombreEstadoPedido(p.estado, p.pago.estado).toLowerCase().includes(termino),
  )
})

const totalFacturado = computed(() => visibles.value.reduce((suma, p) => suma + p.total, 0))

onMounted(cargar)

async function cargar(): Promise<void> {
  cargando.value = true
  try {
    pedidos.value = await http.get<Pedido[]>('/admin/pedidos', {
      query: { limite: limite.value },
    })
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
}

async function verMas(): Promise<void> {
  limite.value = Math.min(limite.value + 100, 500)
  await cargar()
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <input
      v-model="busqueda"
      class="form-input"
      type="search"
      placeholder="Buscar por folio, cliente o estado…"
    />

    <p class="admin-list-count">
      {{ visibles.length }} {{ visibles.length === 1 ? 'pedido' : 'pedidos' }} ·
      {{ dinero(totalFacturado) }}
    </p>

    <SkeletonList v-if="cargando" :cantidad="4" />

    <template v-else-if="visibles.length > 0">
      <div class="tabla-envoltorio">
        <table class="tabla">
          <thead>
            <tr>
              <th>Folio</th>
              <th>Cliente</th>
              <th>Estado</th>
              <th>Pago</th>
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="pedido in visibles" :key="pedido.id">
              <td>
                <span class="folio">{{ pedido.folio }}</span>
                <span class="fecha">{{ fechaHora(pedido.creadoEn) }}</span>
              </td>
              <td>{{ pedido.clienteNombre ?? '—' }}</td>
              <td>
                <span class="mini-tag">
                  {{ nombreEstadoPedido(pedido.estado, pedido.pago.estado) }}
                </span>
              </td>
              <td>
                <span class="pago-metodo">{{ nombreMetodoPago(pedido.pago.metodo) }}</span>
                <span class="fecha" :class="{ pendiente: pedido.pago.estado === 'PAGO_PENDIENTE' }">
                  {{ nombreEstadoPago(pedido.pago.estado) }}
                </span>
                <button
                  v-if="puedeValidarPagos && pedido.pago.estado === 'PAGO_PENDIENTE'"
                  type="button"
                  class="btn-secondary validar"
                  :disabled="validando === pedido.id"
                  @click="validarPago(pedido)"
                >
                  {{ validando === pedido.id ? '…' : 'Validar' }}
                </button>
              </td>
              <td class="num">{{ dinero(pedido.total) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="pedidos.length >= limite && limite < 500" class="ver-mas">
        <button type="button" class="btn-secondary" @click="verMas">Cargar más pedidos</button>
      </div>
    </template>

    <p v-else class="empty-block">
      {{ busqueda ? 'Ningún pedido coincide con la búsqueda.' : 'Todavía no hay pedidos.' }}
    </p>
  </div>
</template>

<style scoped>
.pantalla {
  padding: 12px 18px 24px;
}

.admin-back-inline {
  display: inline-block;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  padding: 0 0 14px;
  text-decoration: none;
}

.admin-list-count {
  font-size: 11.5px;
  color: var(--sage);
  font-weight: 700;
  font-family: var(--font-heading);
  margin: 0 0 14px;
}

/* La tabla se desplaza dentro de su caja: la página nunca en horizontal. */
.tabla-envoltorio {
  overflow-x: auto;
  background: var(--white);
  border-radius: 14px;
  box-shadow: var(--shadow);
}

.tabla {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  min-width: 540px;
}

.tabla th {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 9.5px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}

.tabla td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  color: var(--ink);
  vertical-align: top;
}

.tabla tr:last-child td {
  border-bottom: none;
}

.tabla .num {
  text-align: right;
  white-space: nowrap;
  font-family: var(--font-heading);
  font-weight: 700;
}

.folio {
  display: block;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 12px;
  color: var(--terracotta-dark);
  letter-spacing: 0.03em;
}

.fecha {
  display: block;
  font-size: 10px;
  color: var(--muted);
  margin-top: 2px;
  white-space: nowrap;
}

.pago-metodo {
  display: block;
  white-space: nowrap;
}

.fecha.pendiente {
  color: var(--gold-dark);
  font-weight: 700;
}

.validar {
  margin-top: 6px;
  padding: 4px 10px;
  font-size: 11px;
}

.ver-mas {
  margin-top: 14px;
  text-align: center;
}
</style>
