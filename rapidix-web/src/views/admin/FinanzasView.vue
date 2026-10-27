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
 * la barra los filtra mientras se escribe: por folio, canal, cliente, estado
 * del pedido o estatus de pago. El canal es la tienda por la que entró el
 * pedido, y lo resuelve la API. Sustituye a las pestañas por estatus, que con las
 * de sección encima dejaban la pantalla con dos tiras y tres enlaces.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { descargarArchivo, ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import {
  dinero,
  fechaNumerica,
  nombreAbono,
  nombreEstadoPedido,
  nombreMetodoPago,
} from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import LupaBusqueda from '@/components/LupaBusqueda.vue'
import BitacoraPedido from '@/components/BitacoraPedido.vue'
import FacturarPedidoModal from '@/components/FacturarPedidoModal.vue'
import VisorPdfFactura from '@/components/VisorPdfFactura.vue'
import PestanasFinanzas from './finanzas/PestanasFinanzas.vue'
import { buscarPedidos } from './finanzas/busqueda'
import { montoCapturado } from './rutas/liquidacion'
import type {
  BotonPago,
  EstadoPago,
  ItemPedido,
  ListadoFinanzas,
  PedidoEnFinanzas,
} from '@/api/tipos'

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

// ------------------------------------------------------------------
// Factura: Finanzas timbra a nombre del cliente, con la misma hoja que él
// ------------------------------------------------------------------

/**
 * El pedido que se está facturando. Si se puede lo dice la API
 * (`facturable`: pagado y sin CFDI), igual que en Mis pedidos.
 */
const facturando = ref<PedidoEnFinanzas | null>(null)
const descargando = ref<string | null>(null)
/** El PDF se abre en el visor; desde ahí se comparte o se descarga. */
const viendoPdf = ref<PedidoEnFinanzas | null>(null)

async function alFacturar(): Promise<void> {
  facturando.value = null
  // La fila tiene que enseñar ya su PDF y su XML en vez del botón.
  await cargar(false)
}

async function descargarXml(pedido: PedidoEnFinanzas): Promise<void> {
  if (descargando.value) return
  descargando.value = pedido.id
  try {
    await descargarArchivo(
      `/admin/finanzas/pedidos/${pedido.id}/factura/xml`,
      `factura-${pedido.folio}.xml`,
    )
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    descargando.value = null
  }
}

/** El cambio que espera confirmación, con la nota que se está escribiendo. */
const confirmando = ref<{ pedido: PedidoEnFinanzas; boton: BotonPago } | null>(null)
const nota = ref('')

// ------------------------------------------------------------------
// La búsqueda
// ------------------------------------------------------------------

/** Lo que se escribe tras la lupa de la barra (`LupaBusqueda`). */
const consulta = ref('')

/** Lo que pinta la tabla: lo escrito filtra mientras se escribe. */
const visibles = computed(() => buscarPedidos(pedidos.value, consulta.value))

// El detalle abierto puede quedar fuera del filtro: se cierra al escribir.
watch(consulta, () => (abierto.value = null))

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

// ------------------------------------------------------------------
// Precio pactado: otro precio por pieza solo en este pedido
// ------------------------------------------------------------------

/**
 * El renglón al que se le está poniendo precio. Si se puede lo decide la API
 * (`bloqueoPrecio`): mientras no esté pagado ni vaya en el camión. El total
 * nuevo también lo calcula ella; aquí solo se captura el unitario.
 */
const precioDe = ref<{ pedido: PedidoEnFinanzas; item: ItemPedido } | null>(null)
/** Texto y no número: el campo vacío no es cero. */
const precio = ref('')
const notaPrecio = ref('')
const errorPrecio = ref('')
const guardandoPrecio = ref(false)

function abrirPrecio(pedido: PedidoEnFinanzas, item: ItemPedido): void {
  precio.value = String(item.precioUnitario)
  notaPrecio.value = ''
  errorPrecio.value = ''
  precioDe.value = { pedido, item }
}

async function guardarPrecio(): Promise<void> {
  const pendiente = precioDe.value
  if (!pendiente) return
  const capturado = montoCapturado(precio.value)
  if (capturado === null || capturado <= 0) {
    errorPrecio.value = 'Escribe un precio mayor que cero.'
    return
  }

  guardandoPrecio.value = true
  try {
    const actualizado = await http.patch<PedidoEnFinanzas>(
      `/admin/finanzas/pedidos/${pendiente.pedido.id}/items/${pendiente.item.id}/precio`,
      { precio: capturado, ...(notaPrecio.value.trim() && { nota: notaPrecio.value.trim() }) },
    )
    pedidos.value = pedidos.value.map((p) => (p.id === actualizado.id ? actualizado : p))
    ui.exito(
      `${actualizado.folio}: ${pendiente.item.nombre} a ${dinero(capturado)} por pieza. Total ${dinero(actualizado.total)}.`,
    )
    precioDe.value = null
  } catch (fallo) {
    // Un 409 aquí es que el pedido cambió mientras tanto: salió a ruta, se pagó…
    errorPrecio.value = fallo instanceof ErrorApi ? fallo.message : 'No se pudo cambiar el precio.'
  } finally {
    guardandoPrecio.value = false
  }
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
    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <PestanasFinanzas activa="pedidos" />

    <LupaBusqueda
      v-model="consulta"
      etiqueta="Buscar pedidos"
      placeholder="Pedido, canal, cliente, estado o estatus de pago"
    />

    <SkeletonList v-if="cargando" :cantidad="4" />

    <!-- Mismo formato que Operaciones: tabla del panel, pastillas y detalle.
         «Pedido» se queda fija al desplazar a la derecha. -->
    <div v-else-if="visibles.length > 0" class="tabla-envoltorio panel">
      <table class="tabla lineal panel una-fija">
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Canal</th>
            <th>Cliente</th>
            <th>Fecha</th>
            <th>Estado del pedido</th>
            <th>Estatus de pago</th>
            <th>Método de pago</th>
            <th class="num">Total</th>
            <th>Factura</th>
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
              <!-- La tienda por la que entró; «App» o «Ruta» si no pasó por ninguna. -->
              <td>{{ pedido.canal }}</td>
              <td>{{ pedido.clienteNombre ?? '—' }}</td>
              <td>{{ fechaNumerica(pedido.creadoEn) }}</td>
              <td>
                <span class="pastilla estado">{{ nombreEstadoPedido(pedido.estado) }}</span>
              </td>
              <td class="estatus">
                <!-- Los estatus de pago. El actual se pinta hundido; los bloqueados,
                     con su candado (el motivo va en el `title` del botón). -->
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
              </td>
              <td>
                {{ iconoMetodo(pedido.pago.metodo) }} {{ nombreMetodoPago(pedido.pago.metodo) }}
              </td>
              <td class="num importe">{{ dinero(pedido.total) }}</td>
              <!-- Facturado: sus archivos. Si no, el botón, apagado con su motivo
                   mientras no esté pagado. Cancelado no se factura. -->
              <td class="factura">
                <span v-if="pedido.factura" class="en-linea">
                  <button type="button" class="enlace" @click="viendoPdf = pedido">PDF</button>
                  <button
                    type="button"
                    class="enlace"
                    :disabled="descargando !== null"
                    @click="descargarXml(pedido)"
                  >
                    {{ descargando === pedido.id ? 'Descargando…' : 'XML' }}
                  </button>
                </span>
                <button
                  v-else-if="pedido.pago.estado !== 'CANCELADO'"
                  type="button"
                  class="btn-primary"
                  :disabled="!pedido.facturable"
                  :title="pedido.facturable ? undefined : 'Se puede facturar cuando esté pagado.'"
                  @click="facturando = pedido"
                >
                  Facturar
                </button>
                <span v-else class="sin-factura">—</span>
              </td>
            </tr>

            <tr v-if="abierto === pedido.id" class="fila-detalle">
              <td colspan="9">
                <div class="detalle-pedido">
                  <!-- Cada producto con el precio que se cobra, sin el de antes aunque
                       se haya cambiado. Cambiarlo solo se ofrece mientras la API lo deja. -->
                  <ul class="renglones">
                    <li v-for="item in pedido.items" :key="item.id" class="renglon-precio">
                      <span>
                        <strong>{{ item.cantidad }}-</strong>{{ item.nombre }} ·
                        {{ dinero(item.precioUnitario) }} c/u
                      </span>
                      <button
                        v-if="pedido.bloqueoPrecio === null"
                        type="button"
                        class="enlace cambiar-precio"
                        @click="abrirPrecio(pedido, item)"
                      >
                        Cambiar precio
                      </button>
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

    <!-- Precio pactado: se cobra y se factura con él, solo en este pedido. -->
    <div v-if="precioDe" class="modal-overlay" @click.self="precioDe = null">
      <div class="modal-sheet" role="dialog" aria-label="Cambiar precio">
        <div class="modal-handle" />
        <p class="modal-title">Cambiar precio · {{ precioDe.pedido.folio }}</p>
        <p class="modal-texto">
          {{ precioDe.item.cantidad }} × {{ precioDe.item.nombre }}, hoy a
          {{ dinero(precioDe.item.precioUnitario) }} por pieza. El precio nuevo es solo para este
          pedido: se le cobra y se le factura con él, y el total se recalcula.
        </p>

        <div class="zona-captura">
          <label class="form-label" for="precio-nuevo">Precio por pieza (IVA incluido)</label>
          <input
            id="precio-nuevo"
            v-model="precio"
            class="form-input monto"
            :class="{ 'is-invalid': errorPrecio }"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0.00"
            @keyup.enter="guardarPrecio"
          />
          <p v-if="errorPrecio" class="form-error">{{ errorPrecio }}</p>

          <label class="form-label" for="precio-nota">Motivo (opcional)</label>
          <textarea
            id="precio-nota"
            v-model="notaPrecio"
            class="form-textarea"
            rows="2"
            maxlength="500"
            placeholder="Ej.: precio de mayoreo acordado con el cliente"
          />
        </div>

        <div class="modal-actions">
          <button
            type="button"
            class="btn-cancel"
            :disabled="guardandoPrecio"
            @click="precioDe = null"
          >
            Volver
          </button>
          <button
            type="button"
            class="btn-primary"
            :disabled="guardandoPrecio"
            @click="guardarPrecio"
          >
            {{ guardandoPrecio ? 'Guardando…' : 'Cambiar precio' }}
          </button>
        </div>
      </div>
    </div>

    <FacturarPedidoModal
      v-if="facturando"
      :pedido="facturando"
      por-finanzas
      @cerrar="facturando = null"
      @facturado="alFacturar"
    />

    <VisorPdfFactura
      v-if="viendoPdf"
      :ruta="`/admin/finanzas/pedidos/${viendoPdf.id}/factura/pdf`"
      :nombre="`factura-${viendoPdf.folio}.pdf`"
      :titulo="`🧾 Factura ${viendoPdf.folio}`"
      @cerrar="viendoPdf = null"
    />

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

.tabla {
  min-width: 1260px;
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

/* El producto a la izquierda y «Cambiar precio» al final del renglón. */
.renglon-precio {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.tabla .factura .en-linea {
  gap: 12px;
}

.sin-factura {
  color: var(--muted);
}

.tabla .detalle-pedido .enlace.cambiar-precio {
  margin-top: 0;
  font-size: 12px;
}

/* Donde se escribe: bloque crema y campos blancos, para que se vea dónde capturar. */
.zona-captura {
  background: var(--cream-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  margin-bottom: 12px;
}

.zona-captura .form-input,
.zona-captura .form-textarea {
  background: var(--white);
}

.zona-captura .form-textarea {
  margin-bottom: 0;
}

/* 16px reales: con menos, Safari en iPhone amplía la página al enfocar el campo. */
.monto {
  font-size: 16px;
  font-weight: 700;
  text-align: right;
}

.form-error {
  margin: -4px 0 10px;
}
</style>
