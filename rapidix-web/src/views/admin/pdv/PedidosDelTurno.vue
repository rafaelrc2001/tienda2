<script setup lang="ts">
/**
 * PDV → Punto de Venta → Pedidos del turno: lo que se ha capturado en el turno
 * abierto, del más reciente al más viejo, con «Editar» en los que todavía se
 * pueden corregir.
 *
 * Editar no cambia el pedido aquí: pide a la API sus datos de corrección y se
 * los pasa a la caja (`editar`), que lo abre ya lleno. Al guardar, la API
 * cancela el equivocado y captura el bueno en el mismo turno. Cuáles se
 * pueden corregir lo dice la API (`corregibles`): con el corte hecho ya no
 * hay ninguno.
 */
import { ref } from 'vue'
import { http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fechaHora, nombreEstadoPedido } from '@/utils/formato'
import type { CorreccionPdv, Pedido, TurnoPdvConPedidos } from '@/api/tipos'

const props = defineProps<{ turno: TurnoPdvConPedidos }>()
const emit = defineEmits<{ editar: [correccion: CorreccionPdv] }>()

const ui = useUiStore()

/** El pedido cuyos datos se están pidiendo: uno a la vez. */
const abriendo = ref('')

function corregible(pedido: Pedido): boolean {
  return props.turno.corregibles.includes(pedido.id)
}

async function editar(pedido: Pedido): Promise<void> {
  if (abriendo.value) return
  abriendo.value = pedido.id
  try {
    emit('editar', await http.get<CorreccionPdv>(`/admin/pdv/pedidos/${pedido.id}/correccion`))
  } catch (fallo) {
    // 409: se entregó, se facturó o se hizo el corte mientras tanto.
    ui.errorDeApi(fallo)
  } finally {
    abriendo.value = ''
  }
}
</script>

<template>
  <div class="pedidos-turno">
    <p class="ayuda">
      Si te equivocaste en un pedido, tócale «Editar»: se abre en la caja para corregirlo. Al
      guardar, el pedido equivocado se cancela y lo sustituye uno nuevo. Solo mientras el turno siga
      abierto: después del corte de caja ya no se pueden modificar.
    </p>

    <div v-if="turno.pedidos.length > 0" class="tabla-envoltorio">
      <table class="tabla tabla-pedidos">
        <thead>
          <tr>
            <th>Folio</th>
            <th>Hora</th>
            <th>Cliente</th>
            <th>Entrega</th>
            <th>Pago</th>
            <th class="num">Total</th>
            <th>Estatus</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in turno.pedidos"
            :key="p.id"
            :class="{ cancelado: p.pago.estado === 'CANCELADO' }"
          >
            <td class="folio">{{ p.folio }}</td>
            <td class="fecha">{{ fechaHora(p.creadoEn) }}</td>
            <td>{{ p.clienteNombre }}</td>
            <td>{{ p.metodoEntrega === 'TIENDA' ? 'En tienda' : 'A domicilio' }}</td>
            <td>
              {{
                p.pago.estado === 'CREDITO'
                  ? 'Crédito'
                  : p.pago.metodo === 'EFECTIVO'
                    ? 'Efectivo'
                    : 'Transferencia'
              }}
            </td>
            <td class="num">{{ dinero(p.total) }}</td>
            <td>
              <span class="mini-tag">{{ nombreEstadoPedido(p.estado, p.pago.estado) }}</span>
            </td>
            <td class="num">
              <button
                v-if="corregible(p)"
                type="button"
                class="enlace"
                :disabled="abriendo !== ''"
                @click="editar(p)"
              >
                {{ abriendo === p.id ? 'Abriendo…' : 'Editar' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="empty-block">Todavía no hay pedidos en este turno.</p>
  </div>
</template>

<style scoped>
.ayuda {
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.45;
  margin: 0 0 10px;
}

.tabla-pedidos {
  min-width: 640px;
}

.tabla-pedidos .fecha {
  white-space: nowrap;
}

.folio {
  font-family: var(--font-heading);
  font-weight: 700;
  white-space: nowrap;
}

/* El cancelado se queda en la lista —es historia del turno— pero apagado. */
.cancelado td {
  color: var(--muted);
}
</style>
