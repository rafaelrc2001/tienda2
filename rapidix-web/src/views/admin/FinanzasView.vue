<script setup lang="ts">
/**
 * Administración → Finanzas: el eje del dinero.
 *
 * Los siete estatus no llevan orden entre ellos: Finanzas mueve el pedido de
 * cualquiera a cualquiera. Lo único que frena es el candado de lo que ya salió
 * de bodega y el de un pedido cancelado, y los dos los calcula la API: cada
 * pedido llega con sus botones y el motivo de los que no se pueden pulsar.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fechaHora, nombreEstadoPedido, nombreMetodoPago } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import BitacoraPedido from '@/components/BitacoraPedido.vue'
import type {
  BotonPago,
  EstadoPago,
  FiltroFinanzas,
  ListadoFinanzas,
  PedidoEnFinanzas,
} from '@/api/tipos'

const ui = useUiStore()

const PESTANAS: { filtro: FiltroFinanzas; titulo: string }[] = [
  { filtro: 'por-decidir', titulo: 'Por decidir' },
  { filtro: 'liberados', titulo: 'Liberados' },
  { filtro: 'pagados', titulo: 'Pagados' },
  { filtro: 'cancelados', titulo: 'Cancelados' },
]

/** Verde lo que deja seguir o cierra bien; rojo lo que cancela. */
const VERDES: EstadoPago[] = ['LIBERAR', 'PAGADO']

/**
 * Los dos que mueven dinero de verdad se confirman antes: «Pagado» acredita el
 * cashback en la billetera del cliente y «Cancelado» deshace el pedido entero.
 * Los demás son etiquetas y candados, y pedir confirmación para cada uno sería
 * estorbar el trabajo de todos los días.
 */
const CONFIRMAN: EstadoPago[] = ['PAGADO', 'CANCELADO']

const filtro = ref<FiltroFinanzas>('por-decidir')
const pedidos = ref<PedidoEnFinanzas[]>([])
const conteos = ref<Record<FiltroFinanzas, number> | null>(null)
const cargando = ref(true)
const abierto = ref<string | null>(null)
const cambiando = ref<string | null>(null)
const bitacoraDe = ref<PedidoEnFinanzas | null>(null)

/** El cambio que espera confirmación, con la nota que se está escribiendo. */
const confirmando = ref<{ pedido: PedidoEnFinanzas; boton: BotonPago } | null>(null)
const nota = ref('')

/** Cambiar de pestaña rápido deja respuestas viejas en el aire: gana la última. */
let peticion = 0

async function cargar(conEsqueleto = true): Promise<void> {
  const numero = ++peticion
  if (conEsqueleto) cargando.value = true
  try {
    const respuesta = await http.get<ListadoFinanzas>('/admin/finanzas/pedidos', {
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

function elegir(nuevo: FiltroFinanzas): void {
  if (nuevo === filtro.value) return
  filtro.value = nuevo
  abierto.value = null
  void cargar()
}

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
  // Lo que ya salió de la pestaña se va de la lista, y los contadores se ponen
  // al día.
  await cargar(false)
}

/** El nombre del estatus sale de la API, que es quien manda los botones. */
function tituloDe(pedido: PedidoEnFinanzas, estado: EstadoPago): string {
  return pedido.botones.find((b) => b.estado === estado)?.titulo ?? estado
}

function alternar(id: string): void {
  abierto.value = abierto.value === id ? null : id
}

function direccionCorta(pedido: PedidoEnFinanzas): string {
  const d = pedido.direccion as Record<string, string | null> | null
  if (!d) return ''
  return [d.calle, d.colonia, d.ciudad].filter(Boolean).join(' · ')
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

    <template v-else-if="pedidos.length > 0">
      <article v-for="pedido in pedidos" :key="pedido.id" class="pedido">
        <header class="cabecera">
          <div>
            <p class="folio">{{ pedido.folio }}</p>
            <p class="fecha">{{ fechaHora(pedido.creadoEn) }}</p>
          </div>
          <span class="total">{{ dinero(pedido.total) }}</span>
        </header>

        <p class="cliente">
          {{ pedido.clienteNombre ?? '—' }} · {{ nombreMetodoPago(pedido.pago.metodo) }}
          <template v-if="pedido.pago.aPagar > 0">
            · cobrar {{ dinero(pedido.pago.aPagar) }}
          </template>
        </p>

        <div class="etiquetas">
          <span class="mini-tag">{{ nombreEstadoPedido(pedido.estado) }}</span>
          <span v-if="pedido.pago.billetera > 0" class="mini-tag billetera">
            Billetera {{ dinero(pedido.pago.billetera) }}
          </span>
          <span v-if="pedido.cashbackGenerado > 0" class="mini-tag cashback">
            Cashback {{ dinero(pedido.cashbackGenerado) }}
            {{ pedido.cashbackAcreditado ? '✓' : 'al pagarse' }}
          </span>
        </div>

        <!-- Los siete estatus. El actual se pinta hundido; los bloqueados, con
             su candado y el motivo debajo. -->
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

        <p v-if="pedido.botones.some((b) => b.bloqueo?.codigo === 'MERCANCIA_FUERA')" class="bloqueo">
          La mercancía ya salió de bodega: el pedido ya no se puede cancelar.
        </p>
        <p v-else-if="pedido.pago.estado === 'CANCELADO'" class="bloqueo">
          Pedido cancelado: su inventario regresó a bodega. Si el cliente retoma la compra, levanta
          un pedido nuevo.
        </p>

        <div class="enlaces">
          <button type="button" class="enlace" @click="alternar(pedido.id)">
            {{ abierto === pedido.id ? 'Ocultar detalle' : 'Ver detalle' }}
          </button>
          <button type="button" class="enlace" @click="bitacoraDe = pedido">Bitácora</button>
        </div>

        <div v-if="abierto === pedido.id" class="detalle">
          <ul class="lineas">
            <li v-for="item in pedido.items" :key="item.productoId">
              <span class="cantidad">{{ item.cantidad }} {{ item.unidad }}</span>
              <span class="nombre">{{ item.nombre }}</span>
              <span class="importe">{{ dinero(item.importe) }}</span>
            </li>
          </ul>

          <div class="fila"><span>Productos</span><span>{{ dinero(pedido.subtotal) }}</span></div>
          <div v-if="pedido.metodoEntrega === 'DOMICILIO'" class="fila">
            <span>Envío</span>
            <span>{{ pedido.envio === 0 ? 'Gratis' : dinero(pedido.envio) }}</span>
          </div>
          <div v-if="pedido.recargoFuera > 0" class="fila">
            <span>Recargo fuera de horario</span><span>{{ dinero(pedido.recargoFuera) }}</span>
          </div>
          <div v-if="pedido.descuento > 0" class="fila">
            <span>{{ pedido.cupon ? `Cupón ${pedido.cupon.code}` : 'Descuento' }}</span>
            <span>−{{ dinero(pedido.descuento) }}</span>
          </div>
          <div v-if="pedido.pago.billetera > 0" class="fila">
            <span>Pagó con su billetera</span><span>−{{ dinero(pedido.pago.billetera) }}</span>
          </div>
          <div class="fila fuerte">
            <span>
              {{
                pedido.pago.aPagar > 0 ? `A cobrar · ${nombreMetodoPago(pedido.pago.metodo)}` : 'Cubierto'
              }}
            </span>
            <span>{{ dinero(pedido.pago.aPagar) }}</span>
          </div>
          <p v-if="pedido.pago.pagoCon !== null && pedido.pago.cambio !== null" class="nota-pago">
            💵 Paga con {{ dinero(pedido.pago.pagoCon) }} · Cambio {{ dinero(pedido.pago.cambio) }}
          </p>
          <p class="nota-pago">🧾 Referencia de transferencia: {{ pedido.pago.referencia }}</p>
          <p v-if="direccionCorta(pedido)" class="nota-pago">📍 {{ direccionCorta(pedido) }}</p>
        </div>
      </article>
    </template>

    <p v-else class="empty-block">
      {{
        filtro === 'por-decidir'
          ? 'No hay pedidos esperando una decisión. 🎉'
          : 'No hay pedidos en esta pestaña.'
      }}
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

.pedido {
  background: var(--white);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
  padding: 14px;
  margin-bottom: 12px;
}

.cabecera {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.folio {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  color: var(--terracotta-dark);
  letter-spacing: 0.04em;
}

.fecha {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--muted);
}

.total {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 15px;
  color: var(--ink);
  white-space: nowrap;
}

.cliente {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: var(--ink);
}

.etiquetas {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.mini-tag.billetera {
  background: var(--cream-2);
  color: var(--terracotta-dark);
}

.mini-tag.cashback {
  background: var(--amarillo);
  color: var(--ink);
}

/* Dos columnas: los siete estatus caben sin que el texto se parta. */
.botonera {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 12px;
}

.btn-pago {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  padding: 9px 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--cream);
  color: var(--ink);
  cursor: pointer;
}

.btn-pago.verde {
  background: var(--verde);
  border-color: var(--verde);
  color: var(--white);
}

.btn-pago.rojo {
  background: var(--rojo);
  border-color: var(--rojo);
  color: var(--white);
}

/* El que ya tiene: hundido y sin color, para que se lea como un estado y no
   como algo por hacer. */
.btn-pago.actual,
.btn-pago.actual.verde,
.btn-pago.actual.rojo {
  background: var(--gris-oscuro);
  border-color: var(--gris-oscuro);
  color: var(--white);
  cursor: default;
}

.btn-pago:disabled:not(.actual) {
  opacity: 0.4;
  cursor: not-allowed;
}

.bloqueo {
  margin: 8px 0 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--orange-dark);
}

.enlaces {
  display: flex;
  gap: 16px;
  margin-top: 10px;
}

.enlace {
  background: none;
  border: none;
  padding: 4px 0;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  color: var(--terracotta-dark);
  cursor: pointer;
}

.detalle {
  border-top: 1px solid var(--line);
  margin-top: 10px;
  padding-top: 10px;
}

.lineas {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
}

.lineas li {
  display: flex;
  gap: 8px;
  font-size: 12.5px;
  color: var(--ink);
  padding: 3px 0;
}

.lineas .cantidad {
  flex-shrink: 0;
  font-family: var(--font-heading);
  font-weight: 700;
  color: var(--muted);
}

.lineas .nombre {
  flex: 1;
  min-width: 0;
}

.lineas .importe {
  flex-shrink: 0;
  font-weight: 600;
}

.fila {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
  color: var(--ink);
  padding: 3px 0;
}

.fila.fuerte {
  font-family: var(--font-heading);
  font-weight: 800;
  border-top: 1px solid var(--line);
  margin-top: 4px;
  padding-top: 7px;
}

.nota-pago {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--ink);
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
