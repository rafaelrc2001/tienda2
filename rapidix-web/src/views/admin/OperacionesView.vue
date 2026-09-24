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
  fechaNumerica,
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

/**
 * Por ahora la pantalla solo enseña lo que hay por surtir: las pestañas (En
 * ruta, Entregados, Cancelados) se quitaron para limpiar la interfaz. La API
 * sigue aceptando los otros filtros.
 */
const filtro: FiltroOperaciones = 'activos'
const pedidos = ref<PedidoEnPantalla[]>([])
const cargando = ref(true)
const abierto = ref<string | null>(null)
const avanzando = ref<string | null>(null)
const bitacoraDe = ref<PedidoEnPantalla | null>(null)

/** Recargar mientras otra carga sigue en el aire deja respuestas viejas: gana la última. */
let peticion = 0

async function cargar(conEsqueleto = true): Promise<void> {
  const numero = ++peticion
  if (conEsqueleto) cargando.value = true
  try {
    const respuesta = await http.get<ListadoOperaciones>('/admin/operaciones/pedidos', {
      query: { filtro },
    })
    if (numero !== peticion) return
    pedidos.value = respuesta.pedidos
  } catch (fallo) {
    if (numero === peticion) ui.errorDeApi(fallo)
  } finally {
    if (numero === peticion) cargando.value = false
  }
}

onMounted(() => cargar())

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
  // Lo que ya no está por surtir (p. ej. entregado en tienda) se va de la lista.
  await cargar(false)
}

function alternar(id: string): void {
  abierto.value = abierto.value === id ? null : id
}

/** Solo el pedido cancelado dice «Cancelado» en lugar de su paso físico. */
function etiquetaEstado(pedido: PedidoEnPantalla): string {
  return nombreEstadoPedido(pedido.estado, pedido.pago.estado)
}

/** Color del estado de pago: lo retenido en gris, lo cancelado en rojo. */
function clasePago(estado: EstadoPago): string {
  if (estado === 'CANCELADO') return 'pago-cancelado'
  if (estado === 'RETENER') return 'pago-retenido'
  return 'pago-liberado'
}

function direccionCorta(pedido: PedidoEnPantalla): string {
  const d = pedido.direccion as Record<string, string | null> | null
  if (!d) return ''
  return [d.calle, d.colonia, d.ciudad].filter(Boolean).join(' · ')
}

/**
 * Los estados del pedido, en orden, pintados como una fila de botones: cada
 * uno se enciende cuando se dio el anterior. «Entregado» solo lo da aquí un
 * pedido de tienda; el de domicilio lo sigue Rutas y se ve apagado.
 */
const PASOS: EstadoPedido[] = ['EN_PREPARACION', 'PREPARADO', 'LISTO_PARA_ENTREGA', 'ENTREGADO']

const ORDEN_ESTADO: EstadoPedido[] = [
  'CONFIRMADO',
  'EN_PREPARACION',
  'PREPARADO',
  'LISTO_PARA_ENTREGA',
  'RECOLECTADO',
  'EN_RUTA',
  'ENTREGADO',
]

/** El pedido ya pasó por ese estado: el botón queda marcado como hecho. */
function pasoDado(pedido: PedidoEnPantalla, estado: EstadoPedido): boolean {
  return ORDEN_ESTADO.indexOf(pedido.estado) >= ORDEN_ESTADO.indexOf(estado)
}

/** Solo se enciende el paso que la API dice que toca a Operaciones. */
function esPasoSiguiente(pedido: PedidoEnPantalla, estado: EstadoPedido): boolean {
  return (
    pedido.pago.estado !== 'CANCELADO' &&
    pedido.paso.seccion === 'operaciones' &&
    pedido.paso.siguiente === estado
  )
}

/** El bloqueo del paso que toca, para enseñarlo bajo los botones. */
function bloqueoDe(pedido: PedidoEnPantalla): string | null {
  const siguiente = pedido.paso.siguiente
  if (!siguiente || !esPasoSiguiente(pedido, siguiente)) return null
  return pedido.paso.bloqueo?.mensaje ?? null
}

function iconoMetodo(metodo: string): string {
  return metodo === 'TRANSFERENCIA' ? '🏦' : '💵'
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <SkeletonList v-if="cargando" :cantidad="4" />

    <div v-else-if="pedidos.length > 0" class="tabla-envoltorio">
      <table class="tabla lineal">
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
              <!-- Solo el nombre: cómo se entrega va en el detalle. -->
              <td>{{ pedido.clienteNombre ?? '—' }}</td>
              <td>{{ fechaNumerica(pedido.creadoEn) }}</td>
              <td>
                <span class="pastilla estado">{{ etiquetaEstado(pedido) }}</span>
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
                <!-- «Ver» abre el detalle; después, los estados en orden. Solo se
                     enciende el que toca; los ya dados quedan marcados. -->
                <div class="en-linea">
                  <button type="button" class="btn-ver" @click="alternar(pedido.id)">Ver</button>
                  <span class="separador" aria-hidden="true"></span>
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
                <div class="detalle">
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
                    <div v-if="pedido.metodoEntrega === 'DOMICILIO'">
                      <dt>Envío a domicilio</dt>
                      <dd>
                        {{ pedido.envio === 0 ? 'Gratis' : dinero(pedido.envio) }}
                      </dd>
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
                  <p class="nota">
                    {{
                      pedido.metodoEntrega === 'TIENDA' ? '🏪 Recoge en tienda' : '🛵 A domicilio'
                    }}
                  </p>
                  <p v-if="direccionCorta(pedido)" class="nota">📍 {{ direccionCorta(pedido) }}</p>

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

    <p v-else class="empty-block">No hay pedidos por surtir. 🎉</p>

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

.tabla {
  min-width: 860px;
}

/* Filas con aire, como en la referencia: la acción va en botones, no en enlaces. */
.tabla.lineal > tbody > tr:not(.fila-detalle) > td {
  padding: 10px 14px;
}

.tabla.lineal .folio {
  font-size: 13px;
}

/* Con la acción en botones, la tabla es más ancha que la pantalla: la barra
   se queda siempre a la vista para moverla de lado. */
.tabla-envoltorio {
  overflow-x: scroll;
  scrollbar-width: thin;
  scrollbar-color: var(--gris) var(--cream-2);
}

.tabla-envoltorio::-webkit-scrollbar {
  height: 10px;
}

.tabla-envoltorio::-webkit-scrollbar-track {
  background: var(--cream-2);
}

.tabla-envoltorio::-webkit-scrollbar-thumb {
  background: var(--gris);
  border-radius: 999px;
}

/* Flecha abajo: abre el detalle. Abierto, apunta arriba para cerrarlo. */
.chevron {
  background: none;
  border: none;
  padding: 0;
  margin-right: 8px;
  color: var(--muted);
  cursor: pointer;
  display: inline-flex;
  vertical-align: middle;
  transition: transform 0.15s;
}

.chevron.abierto {
  transform: rotate(180deg);
  color: var(--ink);
}

/* Estados en pastilla suave, en minúsculas como se leen. */
.pastilla {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-family: var(--font-heading);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.pastilla.estado {
  background: color-mix(in srgb, var(--gris) 18%, var(--white));
  color: var(--ink);
}

.pastilla.pago-retenido {
  background: color-mix(in srgb, var(--gris-oscuro) 20%, var(--white));
  color: var(--gris-oscuro);
}

.pastilla.pago-liberado {
  background: color-mix(in srgb, var(--verde) 18%, var(--white));
  color: var(--verde-compra);
}

.pastilla.pago-cancelado {
  background: color-mix(in srgb, var(--rojo) 15%, var(--white));
  color: var(--rojo);
}

.separador {
  width: 1px;
  align-self: stretch;
  background: var(--line);
  margin: 0 4px;
}

.tabla.lineal .en-linea > .btn-ver,
.tabla.lineal .en-linea > .btn-paso {
  padding: 5px 12px;
  border-radius: 8px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  background: var(--white);
  cursor: pointer;
}

.btn-ver {
  border: 1px solid var(--line);
  color: var(--ink);
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

/* Detalle: renglones y cuenta, en una columna angosta a la izquierda. Se
   queda fijo aunque la tabla se desplace de lado. */
.detalle {
  position: sticky;
  left: 14px;
  max-width: 480px;
  font-size: 12.5px;
  color: var(--ink);
}

.renglones {
  list-style: none;
  margin: 0;
  padding: 0 0 8px;
  border-bottom: 1px dashed var(--line);
}

.renglones li {
  padding: 2px 0;
}

.cuentas {
  margin: 8px 0 0;
  border-top: 1px solid var(--line);
  padding-top: 6px;
}

.cuentas > div {
  display: flex;
  justify-content: space-between;
  padding: 3px 0;
}

.cuentas dt {
  color: var(--muted);
}

.cuentas dd {
  margin: 0;
  font-weight: 700;
}

.cuentas > .total {
  border-top: 1px solid var(--line);
  margin-top: 4px;
  padding-top: 6px;
}

.cuentas > .total dt {
  color: var(--ink);
  font-weight: 700;
}

.cuentas > .total dd {
  color: var(--verde-compra);
}

.nota {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--muted);
}

.detalle .enlace {
  margin-top: 8px;
}
</style>
