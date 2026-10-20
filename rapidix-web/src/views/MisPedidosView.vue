<script setup lang="ts">
/**
 * Mis Pedidos: historial del cliente (`GET /pedidos/mios`).
 *
 * Es la única sección del panel que un cliente tiene en su menú, así que se
 * llega tanto desde el Perfil como desde el drawer.
 */
import { onMounted, ref } from 'vue'
import { descargarArchivo, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import {
  dinero,
  fechaHora,
  nombreAbono,
  nombreEstadoPago,
  nombreEstadoPedido,
  nombreMetodoPago,
} from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import FacturarPedidoModal from '@/components/FacturarPedidoModal.vue'
import type { Pedido } from '@/api/tipos'

const ui = useUiStore()

const pedidos = ref<Pedido[]>([])
const cargando = ref(true)
const abierto = ref<string | null>(null)
const cancelando = ref<string | null>(null)
const facturando = ref<Pedido | null>(null)
const descargando = ref<string | null>(null)

async function cargar(): Promise<void> {
  try {
    pedidos.value = await http.get<Pedido[]>('/pedidos/mios')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

/**
 * Lo que devuelve la API (inventario, billetera, cashback) lo hace ella; aquí
 * solo se pregunta y se pinta el pedido como quedó.
 */
async function cancelar(pedido: Pedido): Promise<void> {
  if (cancelando.value) return
  const devuelve =
    pedido.pago.billetera > 0
      ? ` Los ${dinero(pedido.pago.billetera)} de tu billetera regresan a tu saldo.`
      : ''
  if (!confirm(`¿Cancelar el pedido ${pedido.folio}?${devuelve}`)) return

  cancelando.value = pedido.id
  try {
    await http.post(`/pedidos/${pedido.id}/cancelar`)
    ui.exito(`Pedido ${pedido.folio} cancelado`)
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cancelando.value = null
  }
  // Tanto si se canceló como si alguien lo movió mientras tanto (409), se
  // enseña lo vigente.
  await cargar()
}

function alternar(id: string): void {
  abierto.value = abierto.value === id ? null : id
}

/**
 * Al timbrar no se toca el pedido a mano: se relee la lista y la API ya lo
 * trae con su `factura`, así que el botón cambia solo por las descargas.
 */
async function alFacturar(): Promise<void> {
  facturando.value = null
  await cargar()
}

async function descargar(pedido: Pedido, formato: 'pdf' | 'xml'): Promise<void> {
  if (descargando.value) return
  descargando.value = `${pedido.id}-${formato}`
  try {
    await descargarArchivo(
      `/pedidos/${pedido.id}/factura/${formato}`,
      `factura-${pedido.folio}.${formato}`,
    )
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    descargando.value = null
  }
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
                    <!-- Recogido en tienda no tiene envío: decir «Gratis» prometería algo
                         que no aplica. -->
                    <tr v-if="pedido.metodoEntrega === 'TIENDA'">
                      <td colspan="2">Entrega en tienda</td>
                      <td class="num">{{ pedido.tienda?.nombre ?? '' }}</td>
                    </tr>
                    <tr v-else>
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
                          pedido.pago.aPagar > 0
                            ? nombreMetodoPago(pedido.pago.metodo)
                            : 'Billetera'
                        }}
                        · {{ nombreEstadoPago(pedido.pago.estado) }}
                      </td>
                      <td class="num">{{ dinero(pedido.pago.aPagar) }}</td>
                    </tr>
                    <!-- Lo abonado y lo que falta, ya calculado por la API. -->
                    <tr v-for="abono in pedido.pago.abonos" :key="abono.id" class="descuento">
                      <td colspan="2">{{ nombreAbono(abono) }}</td>
                      <td class="num">−{{ dinero(abono.monto) }}</td>
                    </tr>
                    <tr v-if="pedido.pago.abonos.length > 0" class="total-fila">
                      <td colspan="2">Saldo</td>
                      <td class="num">{{ dinero(pedido.pago.saldo) }}</td>
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
                <!-- Facturar lo decide la API (`facturable`): pagado y sin CFDI. -->
                <div v-if="pedido.factura" class="factura">
                  <p class="factura-estado">
                    ✓ Facturado
                    <span v-if="pedido.factura.modo === 'SIMULADO'" class="mini-tag">Prueba</span>
                  </p>
                  <p class="factura-uuid">Folio fiscal {{ pedido.factura.uuid }}</p>
                  <div class="factura-acciones">
                    <button
                      type="button"
                      class="btn-secondary"
                      :disabled="descargando !== null"
                      @click="descargar(pedido, 'pdf')"
                    >
                      {{ descargando === `${pedido.id}-pdf` ? 'Descargando…' : 'PDF' }}
                    </button>
                    <button
                      type="button"
                      class="btn-secondary"
                      :disabled="descargando !== null"
                      @click="descargar(pedido, 'xml')"
                    >
                      {{ descargando === `${pedido.id}-xml` ? 'Descargando…' : 'XML' }}
                    </button>
                  </div>
                </div>
                <div v-else-if="pedido.facturable" class="factura">
                  <button type="button" class="btn-primary" @click="facturando = pedido">
                    🧾 Facturar
                  </button>
                </div>
                <p v-else-if="pedido.pago.estado !== 'CANCELADO'" class="factura-pendiente">
                  Podrás facturarlo cuando esté pagado.
                </p>
                <!-- Solo mientras la API lo permite: sigue en bodega y no hay dinero
                     que reembolsar. -->
                <div v-if="pedido.cancelable" class="cancelar">
                  <button
                    type="button"
                    class="btn-cancelar"
                    :disabled="cancelando === pedido.id"
                    @click="cancelar(pedido)"
                  >
                    {{ cancelando === pedido.id ? 'Cancelando…' : 'Cancelar pedido' }}
                  </button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <p v-else class="empty-block">Todavía no has hecho ningún pedido.</p>

    <FacturarPedidoModal
      v-if="facturando"
      :pedido="facturando"
      @cerrar="facturando = null"
      @facturado="alFacturar"
    />
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

.cancelar {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.btn-cancelar {
  background: var(--white);
  color: var(--rojo);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  border: 1.5px solid var(--rojo);
  border-radius: 12px;
  padding: 8px 14px;
  cursor: pointer;
}

.btn-cancelar:disabled {
  opacity: 0.55;
  cursor: default;
}

.factura {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  margin-top: 10px;
}

.factura-estado {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  color: var(--sage);
}

/* El UUID son 36 caracteres sin espacios: en un teléfono tiene que poder partirse. */
.factura-uuid {
  margin: 0;
  font-size: 10.5px;
  color: var(--muted);
  text-align: right;
  overflow-wrap: anywhere;
}

.factura-acciones {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.factura-acciones .btn-secondary:disabled {
  opacity: 0.55;
  cursor: default;
}

.factura-pendiente {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: var(--muted);
  text-align: right;
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
