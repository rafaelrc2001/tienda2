<script setup lang="ts">
/**
 * El detalle que despliega la flecha de un pedido en Rutas: lo comprado, lo
 * que el cliente no aceptó y la evidencia de la entrega.
 *
 * Lo comparten el tablero de Rutas y la pantalla de cada entrega: el mismo
 * pedido se lee igual en las dos.
 */
import { computed } from 'vue'
import { dinero } from '@/utils/formato'
import EvidenciaEntrega from '@/components/EvidenciaEntrega.vue'
import { nombreMotivo } from './etiquetas'
import type { PedidoEnRuta } from '@/api/tipos'

const props = defineProps<{ pedido: PedidoEnRuta }>()

/**
 * Los renglones que el cliente no aceptó, del intento que sea.
 *
 * Se leen aparte de los items del pedido porque no son lo mismo: el pedido es
 * el recibo de lo que se compró y esto lo que el camión trae de vuelta.
 */
const sinAceptar = computed(() =>
  props.pedido.carga.filter((c) => c.cantidadEntregada < c.cantidadCargada),
)
</script>

<template>
  <div>
    <!-- Lo comprado: es el recibo del pedido y no cambia nunca, ni con una
         entrega parcial. -->
    <table class="tabla-lineas angosta">
      <thead>
        <tr>
          <th class="num">Cantidad</th>
          <th>Producto</th>
          <th class="num">Importe</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in pedido.items" :key="item.productoId">
          <td class="num">{{ item.cantidad }} {{ item.unidad }}</td>
          <td>{{ item.nombre }}</td>
          <td class="num">{{ dinero(item.importe) }}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2">Productos</td>
          <td class="num">{{ dinero(pedido.subtotal) }}</td>
        </tr>
        <tr v-if="pedido.envio > 0">
          <td colspan="2">Envío</td>
          <td class="num">{{ dinero(pedido.envio) }}</td>
        </tr>
        <tr v-if="pedido.descuento > 0">
          <td colspan="2">
            {{ pedido.cupon ? `Cupón ${pedido.cupon.code}` : 'Descuento' }}
          </td>
          <td class="num">−{{ dinero(pedido.descuento) }}</td>
        </tr>
        <tr v-if="pedido.pago.billetera > 0">
          <td colspan="2">Pagó con su billetera</td>
          <td class="num">−{{ dinero(pedido.pago.billetera) }}</td>
        </tr>
        <tr class="fuerte">
          <td colspan="2">
            {{ pedido.pago.aPagar > 0 ? 'A cobrar' : 'Cubierto' }}
          </td>
          <td class="num">{{ dinero(pedido.pago.aPagar) }}</td>
        </tr>
      </tfoot>
    </table>

    <!-- Y aparte lo que el cliente no aceptó, que es cosa del camión. -->
    <table v-if="sinAceptar.length > 0" class="tabla-lineas angosta devueltos">
      <thead>
        <tr>
          <th class="num">Sin aceptar</th>
          <th>Producto</th>
          <th>Motivo</th>
          <th>Dónde está</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="renglon in sinAceptar" :key="renglon.pedidoItemId">
          <td class="num">
            {{ renglon.cantidadCargada - renglon.cantidadEntregada }}
            {{ renglon.unidad }}
          </td>
          <td>{{ renglon.nombre }}</td>
          <td class="motivo">
            {{ renglon.motivoDevolucion ? nombreMotivo(renglon.motivoDevolucion) : 'Sin aceptar' }}
          </td>
          <td>
            {{ renglon.enCamion ? 'Sigue en tu camión' : 'Regresó a bodega' }}
          </td>
        </tr>
      </tbody>
    </table>

    <!-- La evidencia con la que se cerró: la foto se carga solo al abrir. -->
    <EvidenciaEntrega v-if="pedido.evidencia" :evidencia="pedido.evidencia" class="evidencia" />
  </div>
</template>

<style scoped>
.tabla-lineas.angosta {
  max-width: 620px;
}

.evidencia {
  margin-top: 10px;
}

/* Lo que vuelve del camión, separado de lo que se compró. */
.tabla-lineas.devueltos .motivo {
  color: var(--orange-dark);
  font-weight: 600;
}
</style>
