<script setup lang="ts">
/**
 * Administración → Finanzas: el eje del dinero.
 *
 * Los siete estatus no llevan orden entre ellos: Finanzas mueve el pedido de
 * cualquiera a cualquiera. Lo único que frena es el candado de lo que ya salió
 * de bodega, el de un pedido cancelado y el de la cuenta por cobrar —que se
 * paga con sus pagos en CXC, no con el botón «Pagado»—, y los tres los calcula
 * la API: cada pedido llega con sus botones y el motivo de los que no se
 * pueden pulsar.
 *
 * Las otras tres pantallas del dinero —cortes de ruta, ingresos y cuentas por
 * cobrar— son las pestañas de arriba (`PestanasFinanzas`).
 *
 * La lista trae todos los pedidos, del más reciente al más viejo, y la lupa de
 * la barra los filtra mientras se escribe: por folio, cliente, estado del
 * pedido o estatus de pago. Sustituye a las pestañas por estatus, que con las
 * de sección encima dejaban la pantalla con dos tiras y tres enlaces.
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fechaNumerica, nombreEstadoPedido, nombreMetodoPago } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import BitacoraPedido from '@/components/BitacoraPedido.vue'
import PestanasFinanzas from './finanzas/PestanasFinanzas.vue'
import { buscarPedidos } from './finanzas/busqueda'
import type { BotonPago, EstadoPago, ListadoFinanzas, PedidoEnFinanzas } from '@/api/tipos'

const ui = useUiStore()

/** El tope de la API: la búsqueda alcanza a los pedidos más recientes. */
const LIMITE = 500

/** Verde lo que deja seguir o cierra bien; rojo lo que cancela. */
const VERDES: EstadoPago[] = ['PAGADO']

/**
 * Los dos que mueven dinero de verdad se confirman antes: «Pagado» acredita el
 * cashback en la billetera del cliente y «Cancelado» deshace el pedido entero.
 * Los demás son etiquetas y candados, y pedir confirmación para cada uno sería
 * estorbar el trabajo de todos los días.
 */
const CONFIRMAN: EstadoPago[] = ['PAGADO', 'CANCELADO']

const pedidos = ref<PedidoEnFinanzas[]>([])
const cargando = ref(true)
const abierto = ref<string | null>(null)
const cambiando = ref<string | null>(null)
const bitacoraDe = ref<PedidoEnFinanzas | null>(null)

/** El cambio que espera confirmación, con la nota que se está escribiendo. */
const confirmando = ref<{ pedido: PedidoEnFinanzas; boton: BotonPago } | null>(null)
const nota = ref('')

// ------------------------------------------------------------------
// La búsqueda
// ------------------------------------------------------------------

/** La lupa de la barra abre el campo; cerrarla lo deja en blanco. */
const buscando = ref(false)
const consulta = ref('')
const campoBusqueda = ref<HTMLInputElement | null>(null)

/** Lo que pinta la tabla: lo escrito filtra mientras se escribe. */
const visibles = computed(() => buscarPedidos(pedidos.value, consulta.value))

async function alternarBusqueda(): Promise<void> {
  buscando.value = !buscando.value
  consulta.value = ''
  abierto.value = null
  if (!buscando.value) return
  await nextTick()
  campoBusqueda.value?.focus()
}

/** Una recarga puede cruzarse con otra: gana la última. */
let peticion = 0

async function cargar(conEsqueleto = true): Promise<void> {
  const numero = ++peticion
  if (conEsqueleto) cargando.value = true
  try {
    const respuesta = await http.get<ListadoFinanzas>('/admin/finanzas/pedidos', {
      query: { filtro: 'todos', limite: LIMITE },
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

function pulsar(pedido: PedidoEnFinanzas, boton: BotonPago): void {
  if (boton.actual || boton.bloqueo || cambiando.value) return
  if (CONFIRMAN.includes(boton.estado)) {
    nota.value = ''
    confirmando.value = { pedido, boton }
    return
  }
  void aplicar(pedido, boton.estado)
}

function confirmar(): void {
  const pendiente = confirmando.value
  if (!pendiente) return
  // Un pedido cancelado meses después solo se explica por su motivo: es lo
  // único que la bitácora no puede deducir sola.
  if (pendiente.boton.estado === 'CANCELADO' && !nota.value.trim()) return
  confirmando.value = null
  void aplicar(pendiente.pedido, pendiente.boton.estado, nota.value.trim() || undefined)
}

async function aplicar(
  pedido: PedidoEnFinanzas,
  estado: EstadoPago,
  motivo?: string,
): Promise<void> {
  cambiando.value = pedido.id
  try {
    const actualizado = await http.patch<PedidoEnFinanzas>(
      `/admin/finanzas/pedidos/${pedido.id}/pago`,
      { estado, ...(motivo && { nota: motivo }) },
    )
    ui.exito(`${pedido.folio} → ${tituloDe(actualizado, estado)}`)
    pedidos.value = pedidos.value.map((p) => (p.id === actualizado.id ? actualizado : p))
  } catch (fallo) {
    // Un 409 casi siempre es que Operaciones o Rutas movieron el pedido
    // mientras tanto: se avisa y se recarga para enseñar lo vigente.
    ui.errorDeApi(fallo)
    if (!(fallo instanceof ErrorApi) || fallo.estado !== 409) return
  } finally {
    cambiando.value = null
  }
  // Otro pudo moverlo mientras tanto: se relee para enseñar lo vigente.
  await cargar(false)
}

/** El nombre del estatus sale de la API, que es quien manda los botones. */
function tituloDe(pedido: PedidoEnFinanzas, estado: EstadoPago): string {
  return pedido.botones.find((b) => b.estado === estado)?.titulo ?? estado
}

function alternar(id: string): void {
  abierto.value = abierto.value === id ? null : id
}

function iconoMetodo(metodo: string): string {
  return metodo === 'TRANSFERENCIA' ? '🏦' : '💵'
}

function direccionCorta(pedido: PedidoEnFinanzas): string {
  const d = pedido.direccion as Record<string, string | null> | null
  if (!d) return ''
  return [d.calle, d.colonia, d.ciudad].filter(Boolean).join(' · ')
}
</script>

<template>
  <div class="pantalla-panel sin-colchon">
    <!-- La lupa, en el extremo derecho de la barra, frente a la hamburguesa. -->
    <Teleport defer to="#topbar-acciones">
      <button
        type="button"
        class="lupa"
        :class="{ activa: buscando }"
        :aria-pressed="buscando"
        :title="buscando ? 'Cerrar la búsqueda' : 'Buscar pedidos'"
        aria-label="Buscar pedidos"
        @click="alternarBusqueda"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2" />
          <path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
    </Teleport>

    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <PestanasFinanzas activa="pedidos" />

    <!-- Bloque crema y campo blanco: se ve dónde se escribe. -->
    <div v-if="buscando" class="busqueda">
      <input
        ref="campoBusqueda"
        v-model="consulta"
        class="form-input"
        type="search"
        autocomplete="off"
        enterkeyhint="search"
        placeholder="Pedido, cliente, estado o estatus de pago"
        aria-label="Buscar pedidos"
        @input="abierto = null"
      />
    </div>

    <SkeletonList v-if="cargando" :cantidad="4" />

    <!-- Mismo formato que Operaciones: tabla del panel, pastillas y detalle.
         «Pedido» se queda fija al desplazar a la derecha. -->
    <div v-else-if="visibles.length > 0" class="tabla-envoltorio panel">
      <table class="tabla lineal panel una-fija">
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Cliente</th>
            <th>Fecha</th>
            <th>Estado del pedido</th>
            <th>Estatus de pago</th>
            <th>Método de pago</th>
            <th class="num">Total</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="pedido in visibles" :key="pedido.id">
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
                <span class="pastilla estado">{{ nombreEstadoPedido(pedido.estado) }}</span>
              </td>
              <td class="estatus">
                <!-- Los estatus de pago. El actual se pinta hundido; los bloqueados,
                     con su candado y el motivo debajo. -->
                <div class="botonera">
                  <button
                    v-for="boton in pedido.botones"
                    :key="boton.estado"
                    type="button"
                    class="btn-pago"
                    :class="{
                      actual: boton.actual,
                      verde: VERDES.includes(boton.estado),
                      rojo: boton.estado === 'CANCELADO',
                    }"
                    :disabled="boton.actual || boton.bloqueo !== null || cambiando === pedido.id"
                    :title="boton.bloqueo?.mensaje"
                    @click="pulsar(pedido, boton)"
                  >
                    {{ boton.bloqueo ? '🔒 ' : '' }}{{ boton.titulo }}
                  </button>
                </div>

                <p v-if="pedido.pago.enCxc" class="bloqueo">
                  Cuenta por cobrar: se paga registrando sus pagos en
                  <RouterLink to="/admin/finanzas/cxc">CXC</RouterLink>. Al quedar en cero pasa a
                  Pagado sola.
                </p>
                <p v-if="pedido.pago.estado === 'CANCELADO'" class="bloqueo">
                  Pedido cancelado: su inventario regresó a bodega. Si el cliente retoma la compra,
                  levanta un pedido nuevo.
                </p>
              </td>
              <td>
                {{ iconoMetodo(pedido.pago.metodo) }} {{ nombreMetodoPago(pedido.pago.metodo) }}
              </td>
              <td class="num importe">{{ dinero(pedido.total) }}</td>
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
                    <div v-if="pedido.metodoEntrega === 'DOMICILIO'">
                      <dt>Envío a domicilio</dt>
                      <dd>{{ pedido.envio === 0 ? 'Gratis' : dinero(pedido.envio) }}</dd>
                    </div>
                    <div v-if="pedido.recargoFuera > 0">
                      <dt>Recargo fuera de horario</dt>
                      <dd>{{ dinero(pedido.recargoFuera) }}</dd>
                    </div>
                    <div v-if="pedido.descuento > 0">
                      <dt>{{ pedido.cupon ? `Cupón ${pedido.cupon.code}` : 'Descuento' }}</dt>
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

                  <p
                    v-if="pedido.pago.pagoCon !== null && pedido.pago.cambio !== null"
                    class="nota"
                  >
                    💵 Paga con {{ dinero(pedido.pago.pagoCon) }} · Cambio
                    {{ dinero(pedido.pago.cambio) }}
                  </p>
                  <p class="nota">🧾 Referencia de transferencia: {{ pedido.pago.referencia }}</p>
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

    <p v-else class="empty-block">
      {{ consulta.trim() ? `Ningún pedido coincide con «${consulta.trim()}».` : 'No hay pedidos.' }}
    </p>

    <!-- Confirmación de lo que mueve dinero. -->
    <div v-if="confirmando" class="modal-overlay" @click.self="confirmando = null">
      <div class="modal-sheet" role="dialog" aria-label="Confirmar el cambio de estatus">
        <div class="modal-handle" />
        <p class="modal-title">{{ confirmando.boton.titulo }} · {{ confirmando.pedido.folio }}</p>

        <p class="modal-texto">
          <template v-if="confirmando.boton.estado === 'CANCELADO'">
            El pedido se deshace: su mercancía regresa a bodega y el saldo que usó vuelve a su
            billetera. No se puede revertir.
          </template>
          <template v-else>
            Se da el dinero por recibido y su cashback de
            {{ dinero(confirmando.pedido.cashbackGenerado) }} entra a la billetera del cliente.
          </template>
        </p>

        <label class="campo">
          <span class="etiqueta">
            {{ confirmando.boton.estado === 'CANCELADO' ? 'Motivo' : 'Nota (opcional)' }}
          </span>
          <textarea
            v-model="nota"
            class="form-input"
            rows="3"
            maxlength="500"
            :placeholder="
              confirmando.boton.estado === 'CANCELADO'
                ? 'Por qué se cancela'
                : 'Referencia, fecha del depósito…'
            "
          />
        </label>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" @click="confirmando = null">Volver</button>
          <button
            type="button"
            class="btn-primary"
            :disabled="confirmando.boton.estado === 'CANCELADO' && !nota.trim()"
            @click="confirmar"
          >
            {{ confirmando.boton.titulo }}
          </button>
        </div>
      </div>
    </div>

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
   (`.pantalla-panel`, `.tabla.panel`, `.detalle-pedido` en base.css), igual
   que Operaciones. Aquí solo va lo propio: la tira de estatus de pago. */
.admin-back-inline {
  align-self: flex-start;
  display: inline-block;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  padding: 0 0 8px;
  text-decoration: none;
}

/* La lupa va sobre la barra naranja: blanca, y rellena cuando está abierta. */
.lupa {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1.5px solid transparent;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--white);
  cursor: pointer;
}

.lupa.activa {
  background: var(--white);
  color: var(--orange-dark);
}

.busqueda {
  flex-shrink: 0;
  margin: 0 0 12px;
  padding: 8px 10px;
  background: var(--cream-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
}

/* 16px reales: con menos, Safari en iPhone amplía la página al enfocar el campo. */
.busqueda .form-input {
  margin: 0;
  font-size: 16px;
  background: var(--white);
}

.tabla {
  min-width: 1060px;
}

/* Los estatus uno al costado del otro, como una sola tira. */
.botonera {
  display: flex;
  gap: 4px;
}

/* Misma forma que los pasos de Operaciones; el color dice qué hace cada uno. */
.tabla.lineal .botonera > .btn-pago {
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 12px;
  white-space: nowrap;
  padding: 5px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--white);
  color: var(--ink);
  box-shadow: none;
  cursor: pointer;
}

.tabla.lineal .botonera > .btn-pago.verde {
  background: var(--verde-compra);
  border-color: var(--verde-compra);
  color: var(--white);
}

.tabla.lineal .botonera > .btn-pago.rojo {
  background: var(--rojo);
  border-color: var(--rojo);
  color: var(--white);
}

/* El que ya tiene: hundido y sin color, para que se lea como un estado y no
   como algo por hacer. */
.tabla.lineal .botonera > .btn-pago.actual {
  background: var(--gris-oscuro);
  border-color: var(--gris-oscuro);
  color: var(--white);
  cursor: default;
}

.tabla.lineal .botonera > .btn-pago:disabled:not(.actual) {
  opacity: 0.4;
  cursor: not-allowed;
}

.bloqueo {
  margin: 6px 0 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--orange-dark);
}

.modal-texto {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--ink);
}

.campo {
  display: block;
  margin-bottom: 12px;
}

.etiqueta {
  display: block;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11.5px;
  color: var(--muted);
  margin-bottom: 4px;
}

.campo .form-input {
  resize: vertical;
}
</style>
