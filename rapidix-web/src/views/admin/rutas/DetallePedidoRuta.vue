<script setup lang="ts">
/**
 * El detalle que despliega la flecha de un pedido en Rutas: lo entregado, lo
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

/**
 * Ya entregado, lo que se quedó el cliente con lo que vale; antes, el pedido
 * tal como se compró. Los importes los calcula la API con las cuentas del
 * corte: aquí no se suma nada.
 */
const lineas = computed(() =>
  props.pedido.entregado
    ? props.pedido.entregado.renglones.map((r) => ({ ...r, id: r.pedidoItemId }))
    : props.pedido.items.map((i) => ({ ...i, id: i.productoId })),
)
const productos = computed(() => props.pedido.entregado?.productos ?? props.pedido.subtotal)
const aPagar = computed(() => props.pedido.entregado?.aPagar ?? props.pedido.pago.aPagar)
</script>

<template>
  <div class="detalle">
    <!-- Lo que se quedó el cliente: con una entrega parcial ya no es lo que
         compró, y el "A cobrar" baja con lo que no aceptó. -->
    <table class="tabla-lineas angosta">
      <thead>
        <tr>
          <th class="num">Cantidad</th>
          <th>Producto</th>
          <th class="num">Importe</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="linea in lineas" :key="linea.id">
          <td class="num">{{ linea.cantidad }} {{ linea.unidad }}</td>
          <td>{{ linea.nombre }}</td>
          <td class="num">{{ dinero(linea.importe) }}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2">Productos</td>
          <td class="num">{{ dinero(productos) }}</td>
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
            {{ aPagar > 0 ? 'A cobrar' : 'Cubierto' }}
          </td>
          <td class="num">{{ dinero(aPagar) }}</td>
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
/*
 * La tabla de arriba mide 820px y en el teléfono se desplaza de lado: sin esto
 * el detalle se estiraba a lo ancho de la tabla y el importe quedaba fuera de la
 * pantalla, lejos de su producto. Se queda fijo a la izquierda, mide lo que su
 * contenido y no pasa del ancho que se ve (100vw menos los márgenes).
 */
.detalle {
  position: sticky;
  left: 12px;
  width: max-content;
  max-width: min(620px, calc(100vw - 60px));
}

/* Cantidad, producto e importe juntos, no repartidos a lo ancho. */
.tabla-lineas.angosta {
  width: auto;
  min-width: 260px;
}

.tabla-lineas.angosta td:not(:last-child),
.tabla-lineas.angosta th:not(:last-child) {
  padding-right: 14px;
}

/* El nombre del producto se parte en renglones antes de sacar el importe de la vista. */
.tabla-lineas.angosta tbody td:not(.num) {
  white-space: normal;
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
