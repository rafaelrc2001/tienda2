<script setup lang="ts">
/**
 * Mis Pedidos: historial del cliente (`GET /pedidos/mios`).
 *
 * Es la única sección del panel que un cliente tiene en su menú, así que se
 * llega tanto desde el Perfil como desde el drawer.
 */
import { onMounted, ref } from 'vue'
import { http } from '@/api/http'
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

const pedidos = ref<Pedido[]>([])
const cargando = ref(true)
const abierto = ref<string | null>(null)

onMounted(async () => {
  try {
    pedidos.value = await http.get<Pedido[]>('/pedidos/mios')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
})

function alternar(id: string): void {
  abierto.value = abierto.value === id ? null : id
}
</script>

<template>
  <div class="pedidos">
    <SkeletonList v-if="cargando" :cantidad="3" />

    <div v-else-if="pedidos.length > 0" class="tabla-envoltorio">
      <table class="tabla">
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Estado</th>
            <th class="num">Total</th>
            <th aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="pedido in pedidos" :key="pedido.id">
            <!-- Toda la fila abre el detalle; el teclado entra con Enter o espacio. -->
            <tr
              class="fila-pedido"
              :class="{ 'con-detalle': abierto === pedido.id }"
              tabindex="0"
              :aria-expanded="abierto === pedido.id"
              @click="alternar(pedido.id)"
              @keydown.enter.prevent="alternar(pedido.id)"
              @keydown.space.prevent="alternar(pedido.id)"
            >
              <td>
                <span class="folio">{{ pedido.folio }}</span>
                <span class="sub">{{ fechaHora(pedido.creadoEn) }}</span>
              </td>
              <td>
                <span class="mini-tag">
                  {{ nombreEstadoPedido(pedido.estado, pedido.pago.estado) }}
                </span>
              </td>
              <td class="num importe">{{ dinero(pedido.total) }}</td>
              <td class="chev-celda">
                <span class="chev" :class="{ abierto: abierto === pedido.id }">›</span>
              </td>
            </tr>

            <tr v-if="abierto === pedido.id" class="fila-detalle">
              <td colspan="4">
                <table class="tabla-lineas">
                  <thead>
                    <tr>
                      <th class="num">Cant.</th>
                      <th>Producto</th>
                      <th class="num">Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in pedido.items" :key="item.productoId">
                      <td class="num cantidad">{{ item.cantidad }}×</td>
                      <td>{{ item.nombre }}</td>
                      <td class="num">{{ dinero(item.importe) }}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colspan="2">Productos</td>
                      <td class="num">{{ dinero(pedido.subtotal) }}</td>
                    </tr>
                    <tr>
                      <td colspan="2">Envío</td>
                      <td class="num">
                        {{ pedido.envio === 0 ? 'Gratis' : dinero(pedido.envio) }}
                      </td>
                    </tr>
                    <tr v-if="pedido.recargoFuera > 0">
                      <td colspan="2">Recargo fuera de horario</td>
                      <td class="num">{{ dinero(pedido.recargoFuera) }}</td>
                    </tr>
                    <tr v-if="pedido.descuento > 0" class="descuento">
                      <td colspan="2">
                        {{ pedido.cupon ? `Cupón ${pedido.cupon.code}` : 'Descuento' }}
                      </td>
                      <td class="num">−{{ dinero(pedido.descuento) }}</td>
                    </tr>
                    <tr class="total-fila">
                      <td colspan="2">Total</td>
                      <td class="num">{{ dinero(pedido.total) }}</td>
                    </tr>
                    <tr v-if="pedido.pago.billetera > 0" class="descuento">
                      <td colspan="2">Pagado con billetera</td>
                      <td class="num">−{{ dinero(pedido.pago.billetera) }}</td>
                    </tr>
                    <tr>
                      <td colspan="2">
                        {{
                          pedido.pago.aPagar > 0 ? nombreMetodoPago(pedido.pago.metodo) : 'Billetera'
                        }}
                        · {{ nombreEstadoPago(pedido.pago.estado) }}
                      </td>
                      <td class="num">{{ dinero(pedido.pago.aPagar) }}</td>
                    </tr>
                    <tr v-if="pedido.pago.cambio !== null && pedido.pago.pagoCon !== null">
                      <td colspan="2">Pagas con {{ dinero(pedido.pago.pagoCon) }}</td>
                      <td class="num">Cambio {{ dinero(pedido.pago.cambio) }}</td>
                    </tr>
                  </tfoot>
                </table>
                <!-- Un cancelado ya no lo va a recibir: no se promete. -->
                <p v-if="pedido.cashbackGenerado > 0 && pedido.cashbackAcreditado" class="cashback">
                  Cashback generado: {{ dinero(pedido.cashbackGenerado) }}
                </p>
                <p
                  v-else-if="pedido.cashbackGenerado > 0 && pedido.pago.estado !== 'CANCELADO'"
                  class="cashback"
                >
                  Cashback por acreditar: {{ dinero(pedido.cashbackGenerado) }} al quedar pagado
                </p>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <p v-else class="empty-block">Todavía no has hecho ningún pedido.</p>
  </div>
</template>

<style scoped>
.pedidos {
  padding: 12px 18px 0;
}

.tabla > tbody > tr > td {
  vertical-align: middle;
}

.fila-pedido {
  cursor: pointer;
}

.fila-pedido:focus-visible {
  outline: 2px solid var(--terracotta);
  outline-offset: -2px;
}

.importe {
  font-size: 13.5px;
}

.tabla > tbody > tr > td.chev-celda {
  width: 1%;
  padding-left: 0;
}

.chev {
  display: inline-block;
  font-size: 20px;
  color: var(--muted);
  transition: transform 0.15s ease;
}

.chev.abierto {
  transform: rotate(90deg);
}

.tabla-lineas .cantidad {
  font-family: var(--font-heading);
  font-weight: 700;
  color: var(--muted);
  width: 1%;
}

.tabla-lineas tr.descuento td {
  color: var(--sage);
  font-weight: 700;
}

.tabla-lineas tr.total-fila td {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 14px;
  color: var(--terracotta-dark);
  border-top: 1px solid var(--line);
  padding-top: 7px;
}

.cashback {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11.5px;
  color: var(--sage);
  text-align: right;
  margin: 8px 0 0;
}
</style>
