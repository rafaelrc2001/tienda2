<script setup lang="ts">
/**
 * PDV → Operaciones: los pedidos de la app que el cliente eligió recoger en
 * esta tienda. Aquí se preparan y se entregan; en Administración →
 * Operaciones no salen.
 *
 * Son los mismos pasos que surte bodega, y la pantalla tampoco decide nada:
 * cada pedido llega con su `paso` calculado por la API. Al entregarlo, la
 * mercancía sale del inventario de la tienda.
 *
 * Los pedidos capturados en el mostrador no pasan por aquí: esos no se
 * preparan, se entregan desde la caja o desde Corte de caja.
 */
import { onMounted, ref, watch } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import {
  dinero,
  fechaNumerica,
  nombreAbono,
  nombreEstadoPago,
  nombreEstadoPedido,
  nombreMetodoPago,
} from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import BitacoraPedido from '@/components/BitacoraPedido.vue'
import ComprobanteWhatsApp from '@/components/ComprobanteWhatsApp.vue'
import { PASOS, bloqueoDe, esPasoSiguiente, pasoDado } from '../operaciones/pasos'
import type { EstadoPago, PedidoEnPantalla, Tienda } from '@/api/tipos'

const props = defineProps<{ tienda: Tienda; porPreparar: number }>()
/** Un pedido avanzó: quien pinta el aviso de la pestaña vuelve a contarlos. */
const emit = defineEmits<{ cambio: [] }>()

const ui = useUiStore()

const pedidos = ref<PedidoEnPantalla[]>([])
const cargando = ref(true)
const abierto = ref<string | null>(null)
const avanzando = ref<string | null>(null)
const bitacoraDe = ref<PedidoEnPantalla | null>(null)
/** El pedido recién entregado, para mandarle su comprobante por WhatsApp. */
const comprobante = ref<PedidoEnPantalla | null>(null)

/** Recargar mientras otra carga sigue en el aire deja respuestas viejas: gana la última. */
let peticion = 0

async function cargar(conEsqueleto = true): Promise<void> {
  const numero = ++peticion
  if (conEsqueleto) cargando.value = true
  try {
    const respuesta = await http.get<PedidoEnPantalla[]>(
      `/admin/pdv/tiendas/${props.tienda.id}/operaciones`,
    )
    if (numero !== peticion) return
    pedidos.value = respuesta
  } catch (fallo) {
    if (numero === peticion) ui.errorDeApi(fallo)
  } finally {
    if (numero === peticion) cargando.value = false
  }
}

onMounted(() => cargar())

// La campana se sondea sola: si su número cambia con la pestaña abierta es que
// entró un pedido o alguien más movió uno, y la tabla se pone al día sin
// esqueleto para no brincar bajo el dedo de quien está surtiendo.
watch(
  () => props.porPreparar,
  () => void cargar(false),
)

async function avanzar(pedido: PedidoEnPantalla): Promise<void> {
  const destino = pedido.paso.siguiente
  if (!destino || avanzando.value) return
  avanzando.value = pedido.id
  try {
    const actualizado = await http.patch<PedidoEnPantalla>(
      `/admin/pdv/tiendas/${props.tienda.id}/operaciones/pedidos/${pedido.id}/estado`,
      { estado: destino },
    )
    ui.exito(`${pedido.folio} → ${nombreEstadoPedido(actualizado.estado)}`)
    pedidos.value = pedidos.value.map((p) => (p.id === actualizado.id ? actualizado : p))
    if (actualizado.estado === 'ENTREGADO') comprobante.value = actualizado
  } catch (fallo) {
    // Un 409 casi siempre es que alguien más (Finanzas, otro compañero) lo
    // movió mientras tanto: se avisa y se recarga para enseñar lo vigente.
    ui.errorDeApi(fallo)
    if (!(fallo instanceof ErrorApi) || fallo.estado !== 409) return
  } finally {
    avanzando.value = null
  }
  emit('cambio')
  // El entregado ya no está por surtir: se va de la lista.
  await cargar(false)
}

function alternar(id: string): void {
  abierto.value = abierto.value === id ? null : id
}

/** Color del estado de pago: lo retenido en gris, lo cancelado en rojo. */
function clasePago(estado: EstadoPago): string {
  if (estado === 'CANCELADO') return 'pago-cancelado'
  if (estado === 'RETENER') return 'pago-retenido'
  return 'pago-liberado'
}

function iconoMetodo(metodo: string): string {
  return metodo === 'TRANSFERENCIA' ? '🏦' : '💵'
}
</script>

<template>
  <div class="operaciones-tienda">
    <SkeletonList v-if="cargando" :cantidad="3" />

    <!-- «Pedido» se queda fija: al desplazar a la derecha se sigue viendo de cuál es la fila. -->
    <div v-else-if="pedidos.length > 0" class="tabla-envoltorio">
      <table class="tabla lineal panel una-fija">
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Cliente</th>
            <th>Fecha</th>
            <th>Estado del pedido</th>
            <th>Estado de pago</th>
            <th class="num">Total</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="pedido in pedidos" :key="pedido.id">
            <tr :class="{ 'con-detalle': abierto === pedido.id }">
              <td>
                <button
                  type="button"
                  class="chevron"
                  :class="{ abierto: abierto === pedido.id }"
                  :aria-expanded="abierto === pedido.id"
                  :aria-label="`Detalle de ${pedido.folio}`"
                  @click="alternar(pedido.id)"
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <path
                      d="M4 6l4 4 4-4"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </button>
                <span class="folio">{{ pedido.folio }}</span>
              </td>
              <td>{{ pedido.clienteNombre ?? '—' }}</td>
              <td>{{ fechaNumerica(pedido.creadoEn) }}</td>
              <td>
                <span class="pastilla estado">
                  {{ nombreEstadoPedido(pedido.estado, pedido.pago.estado) }}
                </span>
              </td>
              <td>
                <!-- Pago pendiente es lo normal al surtir: va como texto llano, sin
                     pastilla. Los demás estados sí se marcan. -->
                <template v-if="pedido.pago.estado === 'PAGO_PENDIENTE'">
                  {{ nombreEstadoPago(pedido.pago.estado) }}
                </template>
                <span v-else class="pastilla" :class="clasePago(pedido.pago.estado)">
                  {{ nombreEstadoPago(pedido.pago.estado) }}
                </span>
              </td>
              <td class="num importe">{{ dinero(pedido.total) }}</td>
              <td class="accion">
                <!-- Los estados en orden: solo se enciende el que toca y los ya
                     dados quedan marcados. -->
                <div class="en-linea">
                  <button
                    v-for="estado in PASOS"
                    :key="estado"
                    type="button"
                    class="btn-paso"
                    :class="{
                      siguiente: esPasoSiguiente(pedido, estado),
                      hecho: pasoDado(pedido, estado),
                    }"
                    :disabled="
                      !esPasoSiguiente(pedido, estado) ||
                      pedido.paso.bloqueo !== null ||
                      avanzando === pedido.id
                    "
                    @click="avanzar(pedido)"
                  >
                    <template v-if="avanzando === pedido.id && esPasoSiguiente(pedido, estado)">
                      …
                    </template>
                    <template v-else>
                      {{ pasoDado(pedido, estado) ? '✓ ' : ''
                      }}{{ esPasoSiguiente(pedido, estado) && pedido.paso.bloqueo ? '🔒 ' : ''
                      }}{{ nombreEstadoPedido(estado) }}
                    </template>
                  </button>
                </div>

                <p v-if="bloqueoDe(pedido)" class="bloqueo">
                  {{ bloqueoDe(pedido) }}
                </p>
              </td>
            </tr>

            <tr v-if="abierto === pedido.id" class="fila-detalle">
              <td colspan="7">
                <div class="detalle-pedido">
                  <ul class="renglones">
                    <li v-for="item in pedido.items" :key="item.productoId">
                      <strong>{{ item.cantidad }}-</strong>{{ item.nombre }}
                    </li>
                  </ul>

                  <dl class="cuentas">
                    <div>
                      <dt>Subtotal</dt>
                      <dd>{{ dinero(pedido.subtotal) }}</dd>
                    </div>
                    <div v-if="pedido.recargoFuera > 0">
                      <dt>Recargo fuera de horario</dt>
                      <dd>{{ dinero(pedido.recargoFuera) }}</dd>
                    </div>
                    <div v-if="pedido.descuento > 0">
                      <dt>
                        {{ pedido.cupon ? `Cupón ${pedido.cupon.code}` : 'Descuento' }}
                      </dt>
                      <dd>−{{ dinero(pedido.descuento) }}</dd>
                    </div>
                    <div class="total">
                      <dt>Total</dt>
                      <dd>{{ dinero(pedido.total) }}</dd>
                    </div>
                    <div v-if="pedido.pago.billetera > 0">
                      <dt>Pagó con su billetera</dt>
                      <dd>−{{ dinero(pedido.pago.billetera) }}</dd>
                    </div>
                    <div v-if="pedido.pago.billetera > 0">
                      <dt>A cobrar</dt>
                      <dd>{{ dinero(pedido.pago.aPagar) }}</dd>
                    </div>
                    <!-- Lo abonado y lo que falta, ya calculado por la API: igual que en CXC. -->
                    <div v-for="abono in pedido.pago.abonos" :key="abono.id">
                      <dt>{{ nombreAbono(abono) }}</dt>
                      <dd>−{{ dinero(abono.monto) }}</dd>
                    </div>
                    <div v-if="pedido.pago.abonos.length > 0" class="saldo">
                      <dt>Saldo</dt>
                      <dd>{{ dinero(pedido.pago.saldo) }}</dd>
                    </div>
                    <div>
                      <dt>Método de pago</dt>
                      <dd>
                        {{ iconoMetodo(pedido.pago.metodo) }}
                        {{ nombreMetodoPago(pedido.pago.metodo) }}
                      </dd>
                    </div>
                  </dl>

                  <template v-if="pedido.pago.metodo !== 'TRANSFERENCIA' && pedido.pago.aPagar > 0">
                    <p
                      v-if="pedido.pago.pagoCon !== null && pedido.pago.cambio !== null"
                      class="nota"
                    >
                      💵 Paga con {{ dinero(pedido.pago.pagoCon) }} · Cambio
                      {{ dinero(pedido.pago.cambio) }}
                    </p>
                    <p v-else class="nota">💵 No especificó con cuánto paga</p>
                  </template>
                  <p class="nota">🏪 Recoge en {{ tienda.nombre }}</p>

                  <button type="button" class="enlace" @click="bitacoraDe = pedido">
                    Ver bitácora
                  </button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <p v-else class="empty-block">No hay pedidos por recoger en esta tienda. 🎉</p>

    <ComprobanteWhatsApp v-if="comprobante" :pedido="comprobante" @cerrar="comprobante = null" />

    <BitacoraPedido
      v-if="bitacoraDe"
      :pedido-id="bitacoraDe.id"
      :folio="bitacoraDe.folio"
      @cerrar="bitacoraDe = null"
    />
  </div>
</template>

<style scoped>
/* La tabla, las pastillas y el detalle son los del panel de pedidos
   (`.tabla.panel`, `.detalle-pedido` en base.css), como en Operaciones. Aquí
   solo va la fila de pasos. */
.tabla {
  min-width: 860px;
}

.tabla.lineal .en-linea > .btn-paso {
  padding: 5px 12px;
  border-radius: 8px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  background: var(--white);
  cursor: pointer;
}

.btn-paso {
  border: 1px solid var(--line);
  color: var(--ink);
}

/* Mismo selector que el botón base: si no, su fondo blanco gana y el texto
   blanco del paso que toca desaparece. */
.tabla.lineal .en-linea > .btn-paso.siguiente:not(:disabled) {
  border-color: var(--verde-compra);
  background: var(--verde-compra);
  color: var(--white);
}

.btn-paso:disabled {
  color: var(--muted);
  cursor: default;
  opacity: 0.7;
}

.btn-paso.hecho {
  color: var(--verde-compra);
  opacity: 1;
}

.bloqueo {
  margin: 6px 0 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--orange-dark);
}
</style>
