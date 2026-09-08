<script setup lang="ts">
/**
 * Administración → Clientes.
 *
 * Consume el `GET /admin/clientes` que añadió el paso 1 del SPEC 02. Se lista
 * y se filtra; abrir la ficha completa de un cliente queda fuera de alcance.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fecha } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import type { ClienteAdmin, PaginaClientes, PaginaProspectos, ProspectoAdmin } from '@/api/tipos'

const ui = useUiStore()

const ORDENES = [
  { valor: 'ultimoPedido', etiqueta: 'Último pedido' },
  { valor: 'totalGastado', etiqueta: 'Total gastado' },
  { valor: 'pedidos', etiqueta: 'Número de pedidos' },
  { valor: 'creado', etiqueta: 'Fecha de alta' },
] as const

/**
 * Las dos listas de la pantalla.
 *
 * "Clientes" es la oficial: quien ya compró. "Prospectos" son los que dieron
 * su teléfono y su nombre pero todavía no han hecho un pedido; en cuanto lo
 * hacen cambian de pestaña solos.
 */
const pestania = ref<'clientes' | 'prospectos'>('clientes')

const clientes = ref<ClienteAdmin[]>([])
const prospectos = ref<ProspectoAdmin[]>([])
const total = ref(0)
const pagina = ref(1)
const porPagina = ref(25)
const orden = ref<(typeof ORDENES)[number]['valor']>('ultimoPedido')
const busqueda = ref('')
const cargando = ref(true)

const totalPaginas = computed(() => Math.max(1, Math.ceil(total.value / porPagina.value)))
const hayAnterior = computed(() => pagina.value > 1)
const haySiguiente = computed(() => pagina.value < totalPaginas.value)

let temporizador: ReturnType<typeof setTimeout> | undefined

onMounted(cargar)
onBeforeUnmount(() => clearTimeout(temporizador))

// Cambiar el orden o de página recarga al momento.
watch([orden, pagina], cargar)

// Cambiar de pestaña empieza de cero: las dos listas no comparten paginación.
watch(pestania, () => {
  if (pagina.value !== 1) pagina.value = 1
  else void cargar()
})

// Teclear espera a que pares: el buscador vuelve siempre a la primera página.
watch(busqueda, () => {
  clearTimeout(temporizador)
  temporizador = setTimeout(() => {
    if (pagina.value !== 1) pagina.value = 1
    else void cargar()
  }, 300)
})

async function cargar(): Promise<void> {
  cargando.value = true
  try {
    const query = {
      q: busqueda.value.trim() || undefined,
      pagina: pagina.value,
      porPagina: porPagina.value,
    }

    if (pestania.value === 'prospectos') {
      // La lista de prospectos va siempre por fecha de registro: lo que
      // importa aquí es a quién hay que ir a buscar, no cuánto gastó.
      const respuesta = await http.get<PaginaProspectos>('/admin/clientes/prospectos', { query })
      prospectos.value = respuesta.datos
      total.value = respuesta.total
      return
    }

    const respuesta = await http.get<PaginaClientes>('/admin/clientes', {
      query: { ...query, orden: orden.value },
    })
    clientes.value = respuesta.datos
    total.value = respuesta.total
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
}

/** Iniciales para el avatar, como en el mockup. */
function iniciales(nombre: string): string {
  return nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? '')
    .join('')
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <div class="pestanias">
      <button
        type="button"
        :class="{ activa: pestania === 'clientes' }"
        @click="pestania = 'clientes'"
      >
        Clientes
      </button>
      <button
        type="button"
        :class="{ activa: pestania === 'prospectos' }"
        @click="pestania = 'prospectos'"
      >
        Prospectos
      </button>
    </div>

    <div class="filtros">
      <input
        v-model="busqueda"
        class="form-input"
        type="search"
        placeholder="Buscar por nombre o teléfono…"
      />
      <select v-if="pestania === 'clientes'" v-model="orden" class="select-input">
        <option v-for="o in ORDENES" :key="o.valor" :value="o.valor">{{ o.etiqueta }}</option>
      </select>
    </div>

    <p class="admin-list-count">
      <template v-if="pestania === 'clientes'">
        {{ total }} {{ total === 1 ? 'cliente' : 'clientes' }}
      </template>
      <template v-else>
        {{ total }} {{ total === 1 ? 'prospecto' : 'prospectos' }} · aún sin comprar
      </template>
      <span v-if="totalPaginas > 1"> · página {{ pagina }} de {{ totalPaginas }}</span>
    </p>

    <SkeletonList v-if="cargando" :cantidad="4" />

    <template v-else-if="pestania === 'prospectos'">
      <template v-if="prospectos.length > 0">
        <article v-for="p in prospectos" :key="p.id" class="client-card">
          <div class="client-card-top">
            <div class="client-avatar">{{ iniciales(p.nombre) }}</div>
            <div class="datos">
              <p class="client-name">{{ p.nombre }}</p>
              <p class="client-sub">
                {{ p.telefono }}
                <span v-if="p.ciudad"> · {{ p.ciudad }}</span>
                <span v-if="p.estado">, {{ p.estado }}</span>
              </p>
            </div>
          </div>

          <div class="client-detail-row">
            <b>Se registró</b><span>{{ fecha(p.creado) }}</span>
          </div>
          <div class="client-detail-row">
            <b>Dirección</b>
            <span>{{ p.tieneDireccion ? 'Ya la escribió' : 'Sin capturar' }}</span>
          </div>
          <div v-if="p.fuenteCodigo" class="client-detail-row">
            <b>Fuente</b><span>{{ p.fuenteCodigo }}</span>
          </div>
        </article>

        <div v-if="totalPaginas > 1" class="paginacion">
          <button type="button" class="btn-secondary" :disabled="!hayAnterior" @click="pagina--">
            ← Anterior
          </button>
          <span class="indicador">{{ pagina }} / {{ totalPaginas }}</span>
          <button type="button" class="btn-secondary" :disabled="!haySiguiente" @click="pagina++">
            Siguiente →
          </button>
        </div>
      </template>

      <p v-else class="empty-block">
        {{
          busqueda
            ? 'Ningún prospecto coincide con la búsqueda.'
            : 'Nadie se ha registrado sin comprar todavía.'
        }}
      </p>
    </template>

    <template v-else-if="clientes.length > 0">
      <article v-for="cliente in clientes" :key="cliente.id" class="client-card">
        <div class="client-card-top">
          <div class="client-avatar">{{ iniciales(cliente.nombre) }}</div>
          <div class="datos">
            <p class="client-name">{{ cliente.nombre }}</p>
            <p class="client-sub">
              {{ cliente.telefono }}
              <span v-if="cliente.ciudad"> · {{ cliente.ciudad }}</span>
              <span v-if="cliente.estado">, {{ cliente.estado }}</span>
            </p>
          </div>
          <span v-if="cliente.nivel" class="mini-tag">{{ cliente.nivel }}</span>
        </div>

        <div class="client-stats-row">
          <div class="client-stat">
            <span class="n">{{ cliente.pedidos }}</span><span class="l">Pedidos</span>
          </div>
          <div class="client-stat">
            <span class="n">{{ dinero(cliente.totalGastado) }}</span><span class="l">Gastado</span>
          </div>
        </div>

        <div class="client-detail-row">
          <b>Último pedido</b>
          <span>{{ cliente.ultimoPedido ? fecha(cliente.ultimoPedido) : 'Nunca ha comprado' }}</span>
        </div>
        <div class="client-detail-row">
          <b>Alta</b><span>{{ fecha(cliente.creado) }}</span>
        </div>
        <div v-if="cliente.fuenteCodigo" class="client-detail-row">
          <b>Fuente</b><span>{{ cliente.fuenteCodigo }}</span>
        </div>
      </article>

      <div v-if="totalPaginas > 1" class="paginacion">
        <button type="button" class="btn-secondary" :disabled="!hayAnterior" @click="pagina--">
          ← Anterior
        </button>
        <span class="indicador">{{ pagina }} / {{ totalPaginas }}</span>
        <button type="button" class="btn-secondary" :disabled="!haySiguiente" @click="pagina++">
          Siguiente →
        </button>
      </div>
    </template>

    <p v-else class="empty-block">
      {{ busqueda ? 'Ningún cliente coincide con la búsqueda.' : 'Todavía no hay clientes.' }}
    </p>
  </div>
</template>

<style scoped>
.pantalla {
  padding: 12px 18px 24px;
}

.pestanias {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.pestanias button {
  flex: 1;
  padding: 9px 12px;
  border: 1.5px solid var(--line);
  background: var(--white);
  border-radius: 12px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  color: var(--muted);
  cursor: pointer;
}

.pestanias button.activa {
  border-color: var(--terracotta);
  background: var(--terracotta);
  color: var(--white);
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

.filtros {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.filtros .form-input {
  flex: 2;
  min-width: 180px;
  margin-bottom: 0;
}

.filtros .select-input {
  flex: 1;
  min-width: 150px;
  margin-bottom: 0;
}

.admin-list-count {
  font-size: 11.5px;
  color: var(--sage);
  font-weight: 700;
  font-family: var(--font-heading);
  margin: 8px 0 14px;
}

.client-card {
  background: var(--white);
  border-radius: 16px;
  padding: 14px;
  box-shadow: var(--shadow);
  margin-bottom: 12px;
}

.client-card-top {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.client-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--terracotta);
  color: var(--white);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 15px;
  flex-shrink: 0;
}

.datos {
  flex: 1;
  min-width: 0;
}

.client-name {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13.5px;
  color: var(--ink);
  margin: 0;
}

.client-sub {
  font-size: 11px;
  color: var(--muted);
  margin: 1px 0 0;
}

.client-stats-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.client-stat {
  flex: 1;
  background: var(--cream);
  border-radius: 10px;
  padding: 8px 10px;
  text-align: center;
}

.client-stat .n {
  display: block;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 14px;
  color: var(--terracotta-dark);
}

.client-stat .l {
  display: block;
  font-size: 9.5px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-weight: 700;
  margin-top: 2px;
}

.client-detail-row {
  font-size: 11.5px;
  color: var(--ink);
  padding: 3px 0;
  display: flex;
  gap: 6px;
}

.client-detail-row b {
  font-family: var(--font-heading);
  color: var(--muted);
  font-weight: 700;
  min-width: 90px;
  flex-shrink: 0;
}

.paginacion {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 16px;
}

.indicador {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  color: var(--muted);
}
</style>
