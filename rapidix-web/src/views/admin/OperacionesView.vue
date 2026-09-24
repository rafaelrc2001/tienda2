<script setup lang="ts">
/**
 * Administración → Operaciones: surtir los pedidos y dejarlos listos para
 * entrega, o entregarlos en mostrador si se recogen en tienda.
 *
 * La pantalla no decide nada: cada pedido llega con su `paso` calculado por la
 * API (siguiente estado, a quién le toca y por qué está bloqueado). Aquí solo
 * se enciende el botón o se enseña el candado.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import {
  dinero,
  fechaHora,
  nombreEstadoPago,
  nombreEstadoPedido,
  nombreMetodoPago,
} from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import BitacoraPedido from '@/components/BitacoraPedido.vue'
import type {
  EstadoPago,
  EstadoPedido,
  FiltroOperaciones,
  ListadoOperaciones,
  PedidoEnPantalla,
} from '@/api/tipos'

const ui = useUiStore()

const PESTANAS: { filtro: FiltroOperaciones; titulo: string }[] = [
  { filtro: 'activos', titulo: 'Por surtir' },
  { filtro: 'en-ruta', titulo: 'En ruta' },
  { filtro: 'entregados', titulo: 'Entregados' },
  { filtro: 'cancelados', titulo: 'Cancelados' },
]

const filtro = ref<FiltroOperaciones>('activos')
const pedidos = ref<PedidoEnPantalla[]>([])
const conteos = ref<Record<FiltroOperaciones, number> | null>(null)
const cargando = ref(true)
const abierto = ref<string | null>(null)
const avanzando = ref<string | null>(null)
const bitacoraDe = ref<PedidoEnPantalla | null>(null)

/** Cambiar de pestaña rápido deja respuestas viejas en el aire: gana la última. */
let peticion = 0

async function cargar(conEsqueleto = true): Promise<void> {
  const numero = ++peticion
  if (conEsqueleto) cargando.value = true
  try {
    const respuesta = await http.get<ListadoOperaciones>('/admin/operaciones/pedidos', {
      query: { filtro: filtro.value },
    })
    if (numero !== peticion) return
    pedidos.value = respuesta.pedidos
    conteos.value = respuesta.conteos
  } catch (fallo) {
    if (numero === peticion) ui.errorDeApi(fallo)
  } finally {
    if (numero === peticion) cargando.value = false
  }
}

onMounted(() => cargar())

function elegir(nuevo: FiltroOperaciones): void {
  if (nuevo === filtro.value) return
  filtro.value = nuevo
  abierto.value = null
  void cargar()
}

async function avanzar(pedido: PedidoEnPantalla): Promise<void> {
  const destino = pedido.paso.siguiente
  if (!destino || avanzando.value) return
  avanzando.value = pedido.id
  try {
    const actualizado = await http.patch<PedidoEnPantalla>(
      `/admin/operaciones/pedidos/${pedido.id}/estado`,
      { estado: destino },
    )
    ui.exito(`${pedido.folio} → ${nombreEstadoPedido(actualizado.estado)}`)
    pedidos.value = pedidos.value.map((p) => (p.id === actualizado.id ? actualizado : p))
  } catch (fallo) {
    // Un 409 casi siempre es que alguien más (Finanzas, otro compañero) lo
    // movió mientras tanto: se avisa y se recarga para enseñar lo vigente.
    ui.errorDeApi(fallo)
    if (!(fallo instanceof ErrorApi) || fallo.estado !== 409) return
  } finally {
    avanzando.value = null
  }
  // Lo que ya salió de la pestaña (p. ej. entregado en tienda) se va de la
  // lista, y los contadores se ponen al día.
  await cargar(false)
}

function alternar(id: string): void {
  abierto.value = abierto.value === id ? null : id
}

/** Solo el pedido cancelado dice «Cancelado» en lugar de su paso físico. */
function etiquetaEstado(pedido: PedidoEnPantalla): string {
  return nombreEstadoPedido(pedido.estado, pedido.pago.estado)
}

/** Color del estado de pago: lo que frena va en ámbar o gris, lo cancelado en rojo. */
function clasePago(estado: EstadoPago): string {
  if (estado === 'CANCELADO') return 'pago-cancelado'
  if (estado === 'PAGO_PENDIENTE') return 'pago-pendiente'
  if (estado === 'RETENER') return 'pago-retenido'
  return 'pago-liberado'
}

function direccionCorta(pedido: PedidoEnPantalla): string {
  const d = pedido.direccion as Record<string, string | null> | null
  if (!d) return ''
  return [d.calle, d.colonia, d.ciudad].filter(Boolean).join(' · ')
}

const TITULO_PASO: Partial<Record<EstadoPedido, string>> = {
  EN_PREPARACION: 'Empezar a preparar',
  PREPARADO: 'Marcar preparado',
  LISTO_PARA_ENTREGA: 'Listo para entrega',
  ENTREGADO: 'Entregar en tienda',
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <div class="subtab-row" role="tablist">
      <button
        v-for="p in PESTANAS"
        :key="p.filtro"
        type="button"
        role="tab"
        class="subtab"
        :class="{ active: filtro === p.filtro }"
        :aria-selected="filtro === p.filtro"
        @click="elegir(p.filtro)"
      >
        {{ p.titulo }}<template v-if="conteos"> · {{ conteos[p.filtro] }}</template>
      </button>
    </div>

    <SkeletonList v-if="cargando" :cantidad="4" />

    <div v-else-if="pedidos.length > 0" class="tabla-envoltorio">
      <table class="tabla lineal">
        <thead>
          <tr>
            <th>Folio</th>
            <th>Cliente</th>
            <th>Estado</th>
            <th>Pago</th>
            <th class="num">Total</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="pedido in pedidos" :key="pedido.id">
            <tr :class="{ 'con-detalle': abierto === pedido.id }">
              <td>
                <span class="folio">{{ pedido.folio }}</span>
                <span class="sub">{{ fechaHora(pedido.creadoEn) }}</span>
              </td>
              <td>
                {{ pedido.clienteNombre ?? '—' }}
                <span class="sub">
                  {{ pedido.metodoEntrega === 'TIENDA' ? '🏪 Recoge en tienda' : '🛵 A domicilio' }}
                </span>
              </td>
              <td>
                <span class="mini-tag">{{ etiquetaEstado(pedido) }}</span>
              </td>
              <td>
                <span class="mini-tag" :class="clasePago(pedido.pago.estado)">
                  {{ nombreEstadoPago(pedido.pago.estado) }}
                </span>
              </td>
              <td class="num importe">{{ dinero(pedido.total) }}</td>
              <td class="accion">
                <!-- El botón del paso, o por qué no se puede dar. -->
                <div class="en-linea">
                  <template v-if="pedido.pago.estado !== 'CANCELADO'">
                    <button
                      v-if="pedido.paso.siguiente && pedido.paso.seccion === 'operaciones'"
                      type="button"
                      class="btn-primary"
                      :disabled="pedido.paso.bloqueo !== null || avanzando === pedido.id"
                      @click="avanzar(pedido)"
                    >
                      <template v-if="avanzando === pedido.id">…</template>
                      <template v-else>
                        {{ pedido.paso.bloqueo ? '🔒 ' : ''
                        }}{{
                          TITULO_PASO[pedido.paso.siguiente] ??
                          nombreEstadoPedido(pedido.paso.siguiente)
                        }}
                      </template>
                    </button>
                    <p v-else-if="pedido.paso.siguiente" class="aviso">
                      🛵 Listo en bodega: lo recoge Rutas.
                    </p>
                    <p v-else class="aviso hecho">✓ Entregado</p>
                  </template>

                  <div class="enlaces">
                    <button type="button" class="enlace" @click="alternar(pedido.id)">
                      {{ abierto === pedido.id ? 'Ocultar detalle' : 'Ver detalle' }}
                    </button>
                    <button type="button" class="enlace" @click="bitacoraDe = pedido">
                      Bitácora
                    </button>
                  </div>
                </div>

                <p
                  v-if="
                    pedido.pago.estado !== 'CANCELADO' &&
                    pedido.paso.siguiente &&
                    pedido.paso.seccion === 'operaciones' &&
                    pedido.paso.bloqueo
                  "
                  class="bloqueo"
                >
                  {{ pedido.paso.bloqueo.mensaje }}
                </p>
              </td>
            </tr>

            <tr v-if="abierto === pedido.id" class="fila-detalle">
              <td colspan="6">
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
                    <tr v-if="pedido.metodoEntrega === 'DOMICILIO'">
                      <td colspan="2">Envío</td>
                      <td class="num">
                        {{ pedido.envio === 0 ? 'Gratis' : dinero(pedido.envio) }}
                      </td>
                    </tr>
                    <tr v-if="pedido.recargoFuera > 0">
                      <td colspan="2">Recargo fuera de horario</td>
                      <td class="num">{{ dinero(pedido.recargoFuera) }}</td>
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
                        {{
                          pedido.pago.aPagar > 0
                            ? `A cobrar · ${nombreMetodoPago(pedido.pago.metodo)}`
                            : 'Cubierto'
                        }}
                      </td>
                      <td class="num">{{ dinero(pedido.pago.aPagar) }}</td>
                    </tr>
                  </tfoot>
                </table>
                <p
                  v-if="pedido.pago.pagoCon !== null && pedido.pago.cambio !== null"
                  class="nota-pago"
                >
                  💵 Paga con {{ dinero(pedido.pago.pagoCon) }} · Cambio
                  {{ dinero(pedido.pago.cambio) }}
                </p>
                <p v-if="direccionCorta(pedido)" class="nota-pago">
                  📍 {{ direccionCorta(pedido) }}
                </p>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <p v-else class="empty-block">
      {{
        filtro === 'activos' ? 'No hay pedidos por surtir. 🎉' : 'No hay pedidos en esta pestaña.'
      }}
    </p>

    <BitacoraPedido
      v-if="bitacoraDe"
      :pedido-id="bitacoraDe.id"
      :folio="bitacoraDe.folio"
      @cerrar="bitacoraDe = null"
    />
  </div>
</template>

<style scoped>
.pantalla {
  padding: 12px 18px 0;
}

.admin-back-inline {
  display: inline-block;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  padding: 0 0 8px;
  text-decoration: none;
}

.subtab-row {
  margin: 0 0 12px;
}

.tabla {
  min-width: 720px;
}

.mini-tag.pago-pendiente {
  background: var(--amarillo);
  color: var(--ink);
}

.mini-tag.pago-retenido {
  background: var(--gris-oscuro);
  color: var(--white);
}

.mini-tag.pago-liberado {
  background: var(--verde);
  color: var(--white);
}

.mini-tag.pago-cancelado {
  background: var(--rojo);
  color: var(--white);
}

.bloqueo {
  margin: 6px 0 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--orange-dark);
}

.aviso {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}

.aviso.hecho {
  color: var(--verde-dark);
}

.tabla-lineas.angosta {
  max-width: 520px;
}

.nota-pago {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--ink);
}
</style>
