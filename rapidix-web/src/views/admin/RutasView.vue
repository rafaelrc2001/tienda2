<script setup lang="ts">
/**
 * Administración → Rutas: la pantalla del repartidor.
 *
 * Todo cuelga de su jornada, así que la API la manda junto con los pedidos y
 * aquí se pinta arriba, fija: mientras no la haya iniciado no se puede cargar
 * el camión, y el botón lo dice en vez de esperar al 409.
 *
 * Como en Operaciones, la pantalla no decide nada: cada pedido llega con su
 * `paso` calculado por la API y aquí solo se enciende el botón o se enseña el
 * candado. Lo propio de Rutas es lo que va encima del camión —la carga— y lo
 * que se cuenta en la puerta del cliente.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fechaHora, nombreEstadoPedido, nombreMetodoPago } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import EvidenciaEntrega from '@/components/EvidenciaEntrega.vue'
import EntregaModal from './rutas/EntregaModal.vue'
import CorteModal from './rutas/CorteModal.vue'
import { MOTIVOS, nombreMotivo } from './rutas/etiquetas'
import { cobraEnEfectivo } from './rutas/cobro'
import type {
  EstadoPedido,
  FiltroRutas,
  Jornada,
  MotivoDevolucion,
  PedidoEnRuta,
  RenglonDeCarga,
  ResultadoEntrega,
  TableroRutas,
} from '@/api/tipos'

const ui = useUiStore()

const PESTANAS: { filtro: FiltroRutas; titulo: string }[] = [
  { filtro: 'disponibles', titulo: 'En bodega' },
  { filtro: 'en-camion', titulo: 'Mi camión' },
  { filtro: 'entregados', titulo: 'Entregados' },
]

/** El texto del único paso que cada estado tiene por delante en Rutas. */
const TITULO_PASO: Partial<Record<EstadoPedido, string>> = {
  RECOLECTADO: 'Subir al camión',
  EN_RUTA: 'Salir a ruta',
  ENTREGADO: 'Entregar',
}

const filtro = ref<FiltroRutas>('disponibles')
const jornada = ref<Jornada | null>(null)
const pedidos = ref<PedidoEnRuta[]>([])
const conteos = ref<Record<FiltroRutas, number> | null>(null)
const cargando = ref(true)
const moviendo = ref<string | null>(null)
const abierto = ref<string | null>(null)

/** Las tres hojas: contar la entrega, explicar el intento fallido y el corte. */
const entregando = ref<PedidoEnRuta | null>(null)
const noEntregando = ref<PedidoEnRuta | null>(null)
const motivo = ref<MotivoDevolucion | null>(null)
const notaFallo = ref('')
const corteAbierto = ref(false)

/** Cambiar de pestaña rápido deja respuestas viejas en el aire: gana la última. */
let peticion = 0

const trabajando = computed(() => jornada.value !== null && jornada.value.finalizadaEn === null)

/**
 * `silenciosa` es la recarga automática: sin esqueleto y sin avisar si falla.
 * En la calle la señal va y viene, y un error cada minuto por algo que nadie
 * pidió solo estorba; la siguiente vuelta lo vuelve a intentar.
 */
async function cargar(conEsqueleto = true, silenciosa = false): Promise<void> {
  const numero = ++peticion
  if (conEsqueleto) cargando.value = true
  try {
    const respuesta = await http.get<TableroRutas>('/admin/rutas', {
      query: { filtro: filtro.value },
    })
    if (numero !== peticion) return
    jornada.value = respuesta.jornada
    pedidos.value = respuesta.pedidos
    conteos.value = respuesta.conteos
  } catch (fallo) {
    if (numero === peticion && !silenciosa) ui.errorDeApi(fallo)
  } finally {
    if (numero === peticion) cargando.value = false
  }
}

// ------------------------------------------------------------------
// Recarga sola
// ------------------------------------------------------------------

/** Cada cuánto se relee el tablero mientras la pantalla está a la vista. */
const CADA_MS = 60_000

/**
 * Finanzas puede marcar Pagado —o dar Crédito— mientras el repartidor está en
 * bodega, y sin releer seguiría viendo «Falta pago» hasta recargar a mano. Se
 * relee al volver a la pestaña y cada minuto, solo con la pantalla visible y
 * nunca a media acción: la respuesta pisaría lo que está moviendo.
 */
function recargarSola(): void {
  if (document.visibilityState !== 'visible' || moviendo.value) return
  void cargar(false, true)
}

let reloj: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  void cargar()
  reloj = setInterval(recargarSola, CADA_MS)
  document.addEventListener('visibilitychange', recargarSola)
})

onBeforeUnmount(() => {
  clearInterval(reloj)
  document.removeEventListener('visibilitychange', recargarSola)
})

function elegir(nuevo: FiltroRutas): void {
  if (nuevo === filtro.value) return
  filtro.value = nuevo
  abierto.value = null
  void cargar()
}

function alternar(id: string): void {
  abierto.value = abierto.value === id ? null : id
}

// ------------------------------------------------------------------
// La jornada
// ------------------------------------------------------------------

/** «Inicio de entregas», que también reanuda la que se había finalizado. */
async function abrirJornada(): Promise<void> {
  try {
    jornada.value = await http.post<Jornada>('/admin/rutas/jornada')
    ui.exito('Jornada iniciada. Ya puedes cargar el camión.')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  }
  await cargar(false)
}

/** «Finalizar entregas»: no sale nada más hoy, pero la jornada vive hasta el corte. */
async function finalizarJornada(): Promise<void> {
  try {
    jornada.value = await http.post<Jornada>('/admin/rutas/jornada/finalizar')
    ui.info('Entregas finalizadas. Falta tu corte para cerrar el día.')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  }
  await cargar(false)
}

// ------------------------------------------------------------------
// El camión
// ------------------------------------------------------------------

/**
 * Los dos pasos que no piden nada más que pulsarlos: subir al camión y salir a
 * ruta. Entregar tiene su propia hoja porque hay que contar.
 */
async function avanzar(pedido: PedidoEnRuta): Promise<void> {
  const destino = pedido.paso.siguiente
  if (!destino || moviendo.value) return
  if (destino === 'ENTREGADO') {
    entregando.value = pedido
    return
  }

  const ruta = destino === 'RECOLECTADO' ? 'recolectar' : 'en-ruta'
  moviendo.value = pedido.id
  try {
    const actualizado = await http.post<PedidoEnRuta>(
      `/admin/rutas/pedidos/${pedido.id}/${ruta}`,
      {},
    )
    ui.exito(`${pedido.folio} → ${nombreEstadoPedido(actualizado.estado)}`)
  } catch (fallo) {
    // Un 409 casi siempre es que otro compañero se llevó el pedido o que
    // Finanzas lo movió: se avisa y se recarga para enseñar lo vigente.
    ui.errorDeApi(fallo)
    if (!(fallo instanceof ErrorApi) || fallo.estado !== 409) return
  } finally {
    moviendo.value = null
  }
  // Recolectar y salir a ruta cambian de pestaña al pedido: se relee entero.
  await cargar(false)
}

function alEntregar(resultado: ResultadoEntrega): void {
  const { entrega } = resultado
  const cobrado = dinero(entrega.importeEntregado)
  ui.exito(
    entrega.parcial
      ? `Entrega parcial: ${entrega.piezasEntregadas} pieza(s) por ${cobrado}, ` +
          `${entrega.piezasDevueltas} siguen en tu camión.`
      : `${resultado.pedido.folio} entregado · ${cobrado}`,
  )
  entregando.value = null
  void cargar(false)
}

/**
 * «No entregado»: el intento que no llegó a entrega. El pedido **no se cierra**
 * —la mercancía sigue arriba— y por eso no hay nada que contar, solo el motivo.
 */
async function noEntregar(): Promise<void> {
  const pedido = noEntregando.value
  if (!pedido || !motivo.value) return

  moviendo.value = pedido.id
  try {
    await http.post(`/admin/rutas/pedidos/${pedido.id}/no-entregar`, {
      motivo: motivo.value,
      ...(notaFallo.value.trim() ? { nota: notaFallo.value.trim() } : {}),
    })
    ui.info(`${pedido.folio}: ${nombreMotivo(motivo.value)}. La mercancía sigue en tu camión.`)
    noEntregando.value = null
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    moviendo.value = null
  }
  await cargar(false)
}

/**
 * Cerrar la hoja del corte relee el tablero: si llegó a cortar, la jornada ya
 * murió y el camión está vacío.
 */
function cerrarCorte(): void {
  corteAbierto.value = false
  void cargar(false)
}

function abrirNoEntregado(pedido: PedidoEnRuta): void {
  motivo.value = null
  notaFallo.value = ''
  noEntregando.value = pedido
}

/** Desde la hoja de entrega: la incidencia es el mismo «No entregado». */
function reportarIncidencia(): void {
  const pedido = entregando.value
  entregando.value = null
  if (pedido) abrirNoEntregado(pedido)
}

// ------------------------------------------------------------------
// Lectura de la tarjeta
// ------------------------------------------------------------------

function direccionCorta(pedido: PedidoEnRuta): string {
  const d = pedido.direccion as Record<string, string | null> | null
  if (!d) return ''
  return [d.calle, d.colonia, d.ciudad].filter(Boolean).join(' · ')
}

/** Lo que sigue arriba del camión de ese pedido. */
function piezasArriba(pedido: PedidoEnRuta): number {
  return pedido.carga
    .filter((c) => c.enCamion)
    .reduce((suma, c) => suma + c.cantidadCargada - c.cantidadEntregada, 0)
}

/**
 * Los renglones que el cliente no aceptó, del intento que sea.
 *
 * Se leen aparte de los items del pedido porque no son lo mismo: el pedido es
 * el recibo de lo que se compró y esto lo que el camión trae de vuelta.
 */
/** Le queda la entrega por delante y el dinero todavía no la permite. */
function faltaPago(pedido: PedidoEnRuta): boolean {
  return pedido.paso.siguiente !== null && !pedido.pagoCubierto
}

function sinAceptar(pedido: PedidoEnRuta): RenglonDeCarga[] {
  return pedido.carga.filter((c) => c.cantidadEntregada < c.cantidadCargada)
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <!-- La jornada manda sobre todo lo demás, así que va arriba y siempre. -->
    <section class="jornada" :class="{ activa: trabajando }">
      <div class="estado">
        <p class="t">
          <template v-if="trabajando">🛵 Jornada abierta</template>
          <template v-else-if="jornada">⏸️ Entregas finalizadas</template>
          <template v-else>🅿️ Sin jornada</template>
        </p>
        <p class="s">
          <template v-if="jornada">
            Desde {{ fechaHora(jornada.iniciadaEn) }} · {{ jornada.piezasEnCamion }} pieza(s) en el
            camión
          </template>
          <template v-else>
            Pulsa «Inicio de entregas» antes de cargar el camión.
          </template>
        </p>
      </div>

      <div class="acciones">
        <button v-if="!trabajando" type="button" class="btn-primary" @click="abrirJornada">
          {{ jornada ? 'Reanudar entregas' : 'Inicio de entregas' }}
        </button>
        <button v-else type="button" class="btn-secondary" @click="finalizarJornada">
          Finalizar entregas
        </button>
        <button
          v-if="jornada"
          type="button"
          class="btn-secondary"
          @click="corteAbierto = true"
        >
          Hacer mi corte
        </button>
      </div>
    </section>

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

    <SkeletonList v-if="cargando" :cantidad="3" />

    <div v-else-if="pedidos.length > 0" class="tabla-envoltorio">
      <table class="tabla lineal">
        <thead>
          <tr>
            <th>Folio</th>
            <th>Cliente</th>
            <th>Estado</th>
            <th>Cobro</th>
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
              <td class="cliente">
                {{ pedido.clienteNombre ?? '—' }}
                <span v-if="direccionCorta(pedido)" class="sub">
                  📍 {{ direccionCorta(pedido) }}
                </span>
              </td>
              <td>
                <div class="en-linea">
                  <span class="mini-tag">
                    {{ nombreEstadoPedido(pedido.estado, pedido.pago.estado) }}
                  </span>
                  <span v-if="piezasArriba(pedido) > 0" class="mini-tag camion">
                    {{ piezasArriba(pedido) }} pieza(s) arriba
                  </span>
                </div>
              </td>
              <td>
                <!-- Sin el pago cubierto no se va a poder entregar: se avisa desde
                     bodega para no cargarlo y salir en balde. -->
                <span
                  v-if="faltaPago(pedido)"
                  class="mini-tag falta-pago"
                  title="No se podrá entregar hasta que Finanzas lo marque Pagado o le dé Crédito"
                >
                  🔒 Falta pago · {{ nombreMetodoPago(pedido.pago.metodo) }}
                </span>
                <span v-else-if="cobraEnEfectivo(pedido)" class="mini-tag cobrar">
                  Cobrar {{ dinero(pedido.pago.aPagar) }}
                </span>
                <span v-else class="mini-tag pagado">
                  {{ nombreMetodoPago(pedido.pago.metodo) }} · no cobras
                </span>
                <span
                  v-if="pedido.pago.pagoCon !== null && pedido.pago.cambio !== null"
                  class="sub"
                >
                  💵 Paga con {{ dinero(pedido.pago.pagoCon) }} · Cambio
                  {{ dinero(pedido.pago.cambio) }}
                </span>
              </td>
              <td class="num importe">{{ dinero(pedido.total) }}</td>
              <td class="accion">
                <!-- El paso que le toca a Rutas, o por qué no se puede dar. -->
                <div class="en-linea">
                  <template v-if="pedido.paso.siguiente && pedido.paso.seccion === 'rutas'">
                    <button
                      type="button"
                      class="btn-primary"
                      :disabled="
                        !trabajando || pedido.paso.bloqueo !== null || moviendo === pedido.id
                      "
                      @click="avanzar(pedido)"
                    >
                      <template v-if="moviendo === pedido.id">…</template>
                      <template v-else>
                        {{ pedido.paso.bloqueo ? '🔒 ' : ''
                        }}{{ TITULO_PASO[pedido.paso.siguiente] }}
                      </template>
                    </button>
                    <button
                      v-if="pedido.estado === 'EN_RUTA'"
                      type="button"
                      class="btn-cancel"
                      :disabled="!trabajando || moviendo === pedido.id"
                      @click="abrirNoEntregado(pedido)"
                    >
                      No entregado
                    </button>
                  </template>
                  <p v-else-if="pedido.paso.siguiente" class="aviso">
                    🏭 Lo está surtiendo Operaciones.
                  </p>
                  <p v-else class="aviso hecho">✓ Entregado · entra en tu corte</p>

                  <div class="enlaces">
                    <button type="button" class="enlace" @click="alternar(pedido.id)">
                      {{ abierto === pedido.id ? 'Ocultar detalle' : 'Ver detalle' }}
                    </button>
                  </div>
                </div>

                <p v-if="pedido.paso.bloqueo" class="bloqueo">
                  {{ pedido.paso.bloqueo.mensaje }}
                </p>
                <p v-else-if="faltaPago(pedido)" class="bloqueo">
                  Aún no está pagado: podrás llevarlo, pero no entregarlo hasta que Finanzas lo
                  marque Pagado o le dé Crédito.
                </p>
                <p
                  v-else-if="
                    !trabajando && pedido.paso.siguiente && pedido.paso.seccion === 'rutas'
                  "
                  class="bloqueo"
                >
                  {{
                    jornada
                      ? 'Finalizaste las entregas de hoy: reanúdalas o haz tu corte.'
                      : 'Inicia tu jornada para mover pedidos.'
                  }}
                </p>
              </td>
            </tr>

            <tr v-if="abierto === pedido.id" class="fila-detalle">
              <td colspan="6">
                <!-- Lo comprado: es el recibo del pedido y no cambia nunca, ni con
                     una entrega parcial. -->
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
                <table v-if="sinAceptar(pedido).length > 0" class="tabla-lineas angosta devueltos">
                  <thead>
                    <tr>
                      <th class="num">Sin aceptar</th>
                      <th>Producto</th>
                      <th>Motivo</th>
                      <th>Dónde está</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="renglon in sinAceptar(pedido)" :key="renglon.pedidoItemId">
                      <td class="num">
                        {{ renglon.cantidadCargada - renglon.cantidadEntregada }}
                        {{ renglon.unidad }}
                      </td>
                      <td>{{ renglon.nombre }}</td>
                      <td class="motivo">
                        {{
                          renglon.motivoDevolucion
                            ? nombreMotivo(renglon.motivoDevolucion)
                            : 'Sin aceptar'
                        }}
                      </td>
                      <td>
                        {{ renglon.enCamion ? 'Sigue en tu camión' : 'Regresó a bodega' }}
                      </td>
                    </tr>
                  </tbody>
                </table>

                <!-- La evidencia con la que se cerró: la foto se carga solo al abrir. -->
                <EvidenciaEntrega
                  v-if="pedido.evidencia"
                  :evidencia="pedido.evidencia"
                  class="evidencia"
                />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <p v-else class="empty-block">
      {{
        filtro === 'disponibles'
          ? 'No hay pedidos esperando camión. 🎉'
          : filtro === 'en-camion'
            ? 'Tu camión está vacío.'
            : 'Todavía no has entregado nada en esta jornada.'
      }}
    </p>

    <EntregaModal
      v-if="entregando"
      :pedido="entregando"
      @cerrar="entregando = null"
      @entregado="alEntregar"
      @incidencia="reportarIncidencia"
    />

    <!-- El intento fallido: un motivo para el pedido entero, obligatorio. -->
    <div v-if="noEntregando" class="modal-overlay" @click.self="noEntregando = null">
      <div class="modal-sheet" role="dialog" aria-label="Marcar como no entregado">
        <div class="modal-handle" />
        <p class="modal-title">No entregado · {{ noEntregando.folio }}</p>
        <p class="modal-texto">
          El pedido no se cierra: la mercancía sigue en tu camión y vuelve a bodega en el corte.
          Puedes intentarlo otra vez hoy mismo.
        </p>

        <select v-model="motivo" class="select-input">
          <option :value="null">¿Por qué no se pudo entregar?</option>
          <option v-for="m in MOTIVOS" :key="m.valor" :value="m.valor">
            {{ m.etiqueta }}
          </option>
        </select>

        <textarea
          v-model="notaFallo"
          class="form-textarea"
          rows="2"
          maxlength="500"
          placeholder="Qué pasó (opcional)"
        />

        <div class="modal-actions">
          <button type="button" class="btn-cancel" @click="noEntregando = null">Volver</button>
          <button
            type="button"
            class="btn-primary"
            :disabled="!motivo || moviendo === noEntregando.id"
            @click="noEntregar"
          >
            Guardar el intento
          </button>
        </div>
      </div>
    </div>

    <CorteModal v-if="corteAbierto" @cortado="cargar(false)" @cerrar="cerrarCorte" />
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

/* La jornada: lo primero que se mira al abrir la pantalla. */
.jornada {
  background: var(--white);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
  border-left: 4px solid var(--line);
  padding: 12px 14px;
  margin-bottom: 12px;
}

.jornada.activa {
  border-left-color: var(--verde);
}

.jornada .t {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13.5px;
  color: var(--ink);
}

.jornada .s {
  margin: 3px 0 0;
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.4;
}

.jornada .acciones {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.jornada .acciones button {
  flex: 1;
  padding: 9px 8px;
  font-size: 12px;
}

.subtab-row {
  margin: 0 0 12px;
}

.tabla {
  min-width: 820px;
}

.mini-tag.cobrar {
  background: var(--amarillo);
  color: var(--ink);
}

.mini-tag.falta-pago {
  background: color-mix(in srgb, var(--rojo) 15%, var(--white));
  color: var(--rojo);
}

.mini-tag.pagado {
  background: var(--cream-2);
  color: var(--muted);
}

.mini-tag.camion {
  background: var(--verde);
  color: var(--white);
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

.bloqueo {
  margin: 6px 0 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--orange-dark);
}

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

.modal-texto {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.45;
}
</style>
