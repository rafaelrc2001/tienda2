<script setup lang="ts">
/**
 * PDV → Punto de Venta: el turno del cajero.
 *
 * Sin turno abierto solo hay «Crear turno», que es la lógica de crear un
 * reparto en Rutas: dentro de él se capturan los pedidos, que ahí mismo se
 * entregan y se cobran, y se cierra con su corte de caja. Con turno, la caja
 * y debajo la tabla de sus pedidos.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fechaHora, nombreEstadoPago, nombreEstadoPedido } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import CajaPdv from './CajaPdv.vue'
import type { Pedido, Tienda, TurnoPdvConPedidos } from '@/api/tipos'

/** La misma clave que la pestaña Inventario: la tienda en la que se trabaja. */
const CLAVE_TIENDA = 'rapidix.pdv.tienda'

const ui = useUiStore()

const turno = ref<TurnoPdvConPedidos | null>(null)
const tiendas = ref<Tienda[]>([])
const tiendaId = ref('')
const cargando = ref(true)
const error = ref('')
const creando = ref(false)
const entregando = ref('')

onMounted(cargar)

async function cargar(): Promise<void> {
  error.value = ''
  try {
    turno.value = await http.get<TurnoPdvConPedidos | null>('/admin/pdv/turnos/abierto')
    if (!turno.value) {
      tiendas.value = await http.get<Tienda[]>('/admin/pdv/tiendas')
      const recordada = localStorage.getItem(CLAVE_TIENDA)
      tiendaId.value =
        tiendas.value.find((t) => t.id === recordada)?.id ?? tiendas.value[0]?.id ?? ''
    }
  } catch (fallo) {
    error.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos cargar el turno.'
  } finally {
    cargando.value = false
  }
}

async function crearTurno(): Promise<void> {
  if (!tiendaId.value) return
  creando.value = true
  try {
    turno.value = await http.post<TurnoPdvConPedidos>('/admin/pdv/turnos', {
      tiendaId: tiendaId.value,
    })
    localStorage.setItem(CLAVE_TIENDA, tiendaId.value)
    ui.exito(`Turno ${turno.value.folio} abierto`)
  } catch (fallo) {
    ui.errorDeApi(fallo)
    // Si ya tenía uno abierto en otra pestaña, se enseña ese.
    await cargar()
  } finally {
    creando.value = false
  }
}

function porEntregar(pedido: Pedido): boolean {
  return (
    pedido.metodoEntrega === 'TIENDA' &&
    pedido.estado !== 'ENTREGADO' &&
    pedido.pago.estado !== 'CANCELADO'
  )
}

/** Entregar desde la tabla: el pedido que se confirmó y se soltó de la caja. */
async function entregar(pedido: Pedido): Promise<void> {
  if (!confirm(`¿Entregar y cobrar el pedido ${pedido.folio} (${dinero(pedido.pago.aPagar)})?`)) {
    return
  }
  entregando.value = pedido.id
  try {
    await http.post(`/admin/pdv/pedidos/${pedido.id}/entregar`)
    ui.exito(`Pedido ${pedido.folio} entregado y cobrado`)
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    entregando.value = ''
    await cargar()
  }
}
</script>

<template>
  <div class="ventana-pdv">
    <SkeletonList v-if="cargando" :cantidad="3" />

    <p v-else-if="error" class="form-error">{{ error }}</p>

    <template v-else-if="!turno">
      <p v-if="tiendas.length === 0" class="empty-block">
        Todavía no hay tiendas. Da de alta una en Configuración → Tiendas para abrir un turno.
      </p>
      <template v-else>
        <div v-if="tiendas.length > 1" class="zona-captura">
          <label class="form-label" for="turno-tienda">Tienda del turno</label>
          <select id="turno-tienda" v-model="tiendaId" class="select-input">
            <option v-for="t in tiendas" :key="t.id" :value="t.id">{{ t.nombre }}</option>
          </select>
        </div>
        <button type="button" class="btn-crear" :disabled="creando" @click="crearTurno">
          {{ creando ? 'Creando…' : '+ Crear Turno' }}
        </button>
      </template>
    </template>

    <template v-else>
      <p class="turno-abierto">
        <strong>{{ turno.folio }}</strong> · {{ turno.tienda.nombre }} · {{ turno.cajero }} ·
        abierto
        {{ fechaHora(turno.abiertoEn) }}
      </p>

      <CajaPdv :turno="turno" @cambio="cargar" />

      <h4>Pedidos del turno</h4>
      <div v-if="turno.pedidos.length > 0" class="tabla-envoltorio">
        <table class="tabla tabla-pedidos">
          <thead>
            <tr>
              <th>Folio</th>
              <th>Cliente</th>
              <th>Entrega</th>
              <th>Pago</th>
              <th class="num">Total</th>
              <th>Estatus</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in turno.pedidos" :key="p.id">
              <td>
                <span class="folio">{{ p.folio }}</span>
                <span class="sub">{{ fechaHora(p.creadoEn) }}</span>
              </td>
              <td>{{ p.clienteNombre }}</td>
              <td>{{ p.metodoEntrega === 'TIENDA' ? 'En tienda' : 'A domicilio' }}</td>
              <td>
                {{ p.pago.metodo === 'EFECTIVO' ? 'Efectivo' : 'Transferencia' }}
                <span class="sub">{{ nombreEstadoPago(p.pago.estado) }}</span>
              </td>
              <td class="num">{{ dinero(p.total) }}</td>
              <td>
                <span class="mini-tag">{{ nombreEstadoPedido(p.estado, p.pago.estado) }}</span>
              </td>
              <td class="num">
                <button
                  v-if="porEntregar(p)"
                  type="button"
                  class="btn-primary entregar"
                  :disabled="entregando !== ''"
                  @click="entregar(p)"
                >
                  {{ entregando === p.id ? 'Entregando…' : 'Entregado' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty-block">Todavía no hay pedidos en este turno.</p>
    </template>
  </div>
</template>

<style scoped>
.zona-captura {
  background: var(--cream);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 12px 14px 2px;
  margin-bottom: 12px;
}

.btn-crear {
  width: 100%;
  height: 48px;
  border: none;
  border-radius: 12px;
  background: var(--sage);
  color: var(--white);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13.5px;
  cursor: pointer;
}

.btn-crear:disabled {
  opacity: 0.6;
}

.turno-abierto {
  font-size: 11.5px;
  color: var(--muted);
  margin: 0 0 10px;
}

.turno-abierto strong {
  font-family: var(--font-heading);
  color: var(--ink);
}

h4 {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13px;
  color: var(--ink);
  margin: 18px 0 10px;
}

.tabla-pedidos {
  min-width: 620px;
}

.sub {
  display: block;
  font-size: 10.5px;
  color: var(--muted);
  margin-top: 2px;
}

.entregar {
  width: auto;
  padding: 0 16px;
}
</style>
