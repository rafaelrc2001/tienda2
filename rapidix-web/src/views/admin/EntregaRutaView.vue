<script setup lang="ts">
/**
 * Rutas → una entrega: el viaje que se está armando o repartiendo.
 *
 * En la cabecera, lo que arranca y cierra la entrega: «Iniciar entrega» —crearla
 * no la arranca, y hasta entonces no se le carga nada— y luego «Finalizar
 * entrega» (o reanudarla). Son de cada entrega, no de la jornada: cada viaje
 * se inicia y se cierra por su lado. El corte no se hace desde aquí: la
 * entrega finalizada pasa a la pestaña Liquidación, que es donde se liquida.
 *
 * Arriba, los pedidos de esta entrega con el paso que les toca: «En ruta» (o
 * quitarlo mientras no haya salido), «Entregar» y «No entregado». Abajo, lo
 * que espera en bodega, con «Recolectado» para subirlo a esta entrega.
 *
 * Que un pedido no quede en dos entregas lo garantiza la API: un pedido que ya
 * va en otra ni siquiera aparece abajo, y si otro teléfono se lo llevó entre
 * medias, la API responde 409 y aquí se relee.
 *
 * Bajo la cabecera, los KPIs de esta entrega (entregas, efectivo esperado,
 * devoluciones), que calcula la API con el mismo alcance que su corte.
 *
 * El camioncito de la barra naranja abre el inventario del camión: por
 * producto, lo recolectado, lo entregado y la diferencia que sigue arriba.
 * Suma todos los pedidos de la entrega.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fechaNumerica, nombreEstadoPedido } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import EntregaModal from './rutas/EntregaModal.vue'
import NoEntregadoModal from './rutas/NoEntregadoModal.vue'
import DetallePedidoRuta from './rutas/DetallePedidoRuta.vue'
import KpisRuta from './rutas/KpisRuta.vue'
import { nombreEntrega, TITULO_PASO } from './rutas/etiquetas'
import { inventarioDelCamion } from './rutas/camion'
import type {
  DetalleEntregaRuta,
  EntregaRuta,
  IndicadoresRuta,
  PedidoEnRuta,
  ResultadoEntrega,
} from '@/api/tipos'

const route = useRoute()
const ui = useUiStore()

const detalle = ref<DetalleEntregaRuta | null>(null)
const cargando = ref(true)
const moviendo = ref<string | null>(null)
/**
 * La hoja guarda el id y no el pedido: al dar un paso desde ella se relee y la
 * hoja sigue abierta con el pedido ya en su nuevo estado.
 */
const enHoja = ref<string | null>(null)
const noEntregando = ref<PedidoEnRuta | null>(null)
/** El pedido con el detalle desplegado bajo su fila, en cualquiera de las dos tablas. */
const abierto = ref<string | null>(null)
const cerrando = ref(false)
/** El inventario del camión, que se abre y se cierra con el camioncito de la barra. */
const viendoCamion = ref(false)

/** Se recalcula con cada relectura: tras entregar, la diferencia ya baja. */
const camion = computed(() => inventarioDelCamion(detalle.value?.pedidos ?? []))

const entregando = computed(() => {
  if (!enHoja.value || !detalle.value) return null
  const { pedidos, disponibles } = detalle.value
  return [...pedidos, ...disponibles].find((p) => p.id === enHoja.value) ?? null
})

/** Los KPIs de esta entrega; `null` pinta «—» mientras llegan o si fallan. */
const indicadores = ref<IndicadoresRuta | null>(null)

let peticion = 0

/**
 * Relee la entrega y sus KPIs juntos: cada paso (entregar, quitar, no
 * entregar) mueve las dos cosas. Si los KPIs fallan se quedan en «—» sin
 * tumbar la pantalla.
 */
async function cargar(conEsqueleto = true): Promise<void> {
  const numero = ++peticion
  const id = String(route.params.id)
  // Con esqueleto puede ser otra entrega: no se enseñan los KPIs de la anterior.
  if (conEsqueleto) {
    cargando.value = true
    indicadores.value = null
  }
  void http
    .get<IndicadoresRuta>(`/admin/rutas/entregas/${id}/indicadores`)
    .then((respuesta) => {
      if (numero === peticion) indicadores.value = respuesta
    })
    .catch(() => {
      if (numero === peticion) indicadores.value = null
    })
  try {
    const respuesta = await http.get<DetalleEntregaRuta>(`/admin/rutas/entregas/${id}`)
    if (numero !== peticion) return
    detalle.value = respuesta
  } catch (fallo) {
    if (numero === peticion) ui.errorDeApi(fallo)
  } finally {
    if (numero === peticion) cargando.value = false
  }
}

onMounted(() => cargar())
// De una entrega a otra (p. ej. desde la etiqueta de un pedido) sin salir de la vista.
watch(
  () => route.params.id,
  () => void cargar(),
)

/** Recién creada: solo se ve «Iniciar entrega» en lugar de «Finalizar». */
const sinIniciar = computed(
  () =>
    detalle.value !== null && detalle.value.abierta && detalle.value.entrega.iniciadaEn === null,
)

/**
 * Se puede cargar (recolectar y quitar) si la entrega sigue abierta —sin
 * corte, de la jornada viva— y no se ha finalizado, aunque no se haya
 * iniciado: primero se carga el camión y luego se inicia para salir.
 */
const puedeCargar = computed(
  () =>
    detalle.value !== null &&
    detalle.value.abierta &&
    detalle.value.entrega.finalizadaEn === null &&
    detalle.value.jornada !== null &&
    detalle.value.jornada.finalizadaEn === null,
)

/** Salir a ruta, entregar y «No entregado» piden además la entrega iniciada. */
const puedeMover = computed(() => puedeCargar.value && detalle.value!.entrega.iniciadaEn !== null)

const avisoBloqueo = computed(() => {
  if (!detalle.value || puedeMover.value) return ''
  if (detalle.value.entrega.cortada) return 'Esta entrega ya tiene su corte: solo se consulta.'
  if (!detalle.value.abierta)
    return 'Esta entrega es de una jornada que ya se cortó: solo se consulta.'
  if (sinIniciar.value) return 'Carga sus pedidos y pulsa «Iniciar entrega» para salir a ruta.'
  if (detalle.value.entrega.finalizadaEn)
    return 'Finalizaste esta entrega: reanúdala para moverla o haz su corte en Liquidación.'
  return 'Tu jornada está finalizada: pulsa «Reanudar entrega» para seguir.'
})

/**
 * Toca reanudar si la entrega o su jornada quedaron finalizadas: la API
 * reabre las dos con el mismo botón, ya que Rutas no tiene otro para la jornada.
 */
const porReanudar = computed(
  () =>
    detalle.value !== null &&
    (detalle.value.entrega.finalizadaEn !== null ||
      (detalle.value.jornada !== null && detalle.value.jornada.finalizadaEn !== null)),
)

// ------------------------------------------------------------------
// Iniciar y cerrar la entrega
// ------------------------------------------------------------------

/** «Iniciar entrega»: desde aquí ya se le suben pedidos. */
async function iniciar(): Promise<void> {
  if (!detalle.value || cerrando.value) return
  cerrando.value = true
  try {
    const entrega = await http.post<EntregaRuta>(
      `/admin/rutas/entregas/${detalle.value.entrega.id}/iniciar`,
      {},
    )
    detalle.value.entrega = entrega
    ui.exito(`${nombreEntrega(entrega)} iniciada. Agrégale sus pedidos.`)
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cerrando.value = false
  }
  await cargar(false)
}

/**
 * «Finalizar entrega» y su vuelta atrás. No exige que todo esté entregado: lo
 * que no se entregó regresa a bodega al cortarla.
 */
async function finalizarOReanudar(): Promise<void> {
  if (!detalle.value || cerrando.value) return
  const finalizar = !porReanudar.value
  cerrando.value = true
  try {
    const entrega = await http.post<EntregaRuta>(
      `/admin/rutas/entregas/${detalle.value.entrega.id}/${finalizar ? 'finalizar' : 'reanudar'}`,
      {},
    )
    detalle.value.entrega = entrega
    if (finalizar) ui.info(`${nombreEntrega(entrega)} finalizada. Falta su corte para cerrarla.`)
    else ui.exito(`${nombreEntrega(entrega)} reanudada.`)
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cerrando.value = false
  }
  await cargar(false)
}

// ------------------------------------------------------------------
// Acciones
// ------------------------------------------------------------------

/** Un POST de Rutas con el mismo manejo para todos: aviso, 409 → releer. */
async function mover(
  pedido: PedidoEnRuta,
  ruta: string,
  cuerpo: Record<string, unknown>,
  exito: (actualizado: PedidoEnRuta) => string,
): Promise<void> {
  if (moviendo.value) return
  moviendo.value = pedido.id
  try {
    const actualizado = await http.post<PedidoEnRuta>(
      `/admin/rutas/pedidos/${pedido.id}/${ruta}`,
      cuerpo,
    )
    ui.exito(exito(actualizado))
  } catch (fallo) {
    // Un 409 casi siempre es que otro teléfono se llevó el pedido o que
    // Finanzas lo movió: se avisa y se relee para enseñar lo vigente.
    ui.errorDeApi(fallo)
    if (!(fallo instanceof ErrorApi) || fallo.estado !== 409) return
  } finally {
    moviendo.value = null
  }
  await cargar(false)
}

/** «Recolectado»: sube el pedido al camión, en esta entrega. */
function recolectar(pedido: PedidoEnRuta): void {
  if (!detalle.value) return
  const entrega = detalle.value.entrega
  void mover(
    pedido,
    'recolectar',
    { entregaId: entrega.id },
    () => `${pedido.folio} → ${nombreEntrega(entrega)}`,
  )
}

function enRuta(pedido: PedidoEnRuta): void {
  void mover(
    pedido,
    'en-ruta',
    {},
    (actualizado) => `${pedido.folio} → ${nombreEstadoPedido(actualizado.estado)}`,
  )
}

/** Lo baja del camión: vuelve a bodega y queda libre para otra entrega. */
function quitar(pedido: PedidoEnRuta): void {
  void mover(pedido, 'quitar-de-entrega', {}, () => `${pedido.folio} regresó a bodega`)
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
  enHoja.value = null
  void cargar(false)
}

/** Un paso dado desde la hoja: el mismo que el botón de la tabla. */
function pasoDesdeHoja(estado: 'RECOLECTADO' | 'EN_RUTA'): void {
  const pedido = entregando.value
  if (!pedido) return
  if (estado === 'RECOLECTADO') recolectar(pedido)
  else enRuta(pedido)
}

function alNoEntregar(): void {
  noEntregando.value = null
  void cargar(false)
}

/** Desde la hoja de entrega: la incidencia es el mismo «No entregado». */
function reportarIncidencia(): void {
  const pedido = entregando.value
  enHoja.value = null
  if (pedido) noEntregando.value = pedido
}

// ------------------------------------------------------------------
// Lectura
// ------------------------------------------------------------------

function alternar(id: string): void {
  abierto.value = abierto.value === id ? null : id
}

function colonia(pedido: PedidoEnRuta): string {
  const d = pedido.direccion as Record<string, string | null> | null
  return d?.colonia || '—'
}
</script>

<template>
  <div class="pantalla">
    <!-- El camioncito, en el extremo derecho de la barra, como la libreta de Operaciones. -->
    <Teleport defer to="#topbar-acciones">
      <button
        type="button"
        class="boton-camion"
        :class="{ activa: viendoCamion }"
        :aria-pressed="viendoCamion"
        :title="viendoCamion ? 'Cerrar el inventario del camión' : 'Lo que llevas en el camión'"
        aria-label="Inventario del camión"
        @click="viendoCamion = !viendoCamion"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            d="M14 17V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h1.5M9.5 17h5M19.5 17H21a1 1 0 0 0 1-1v-4l-3-4h-5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle cx="7" cy="17.5" r="2" fill="none" stroke="currentColor" stroke-width="1.8" />
          <circle cx="17" cy="17.5" r="2" fill="none" stroke="currentColor" stroke-width="1.8" />
        </svg>
      </button>
    </Teleport>

    <RouterLink to="/admin/rutas" class="admin-back-inline">← Rutas</RouterLink>

    <SkeletonList v-if="cargando" :cantidad="3" />

    <template v-else-if="detalle">
      <header class="cabeza" :class="{ cerrada: !puedeCargar }">
        <div class="datos">
          <p class="titulo">
            {{ nombreEntrega(detalle.entrega) }}
            <span v-if="detalle.entrega.cortada" class="mini-tag">Cortada</span>
            <span v-else-if="detalle.entrega.finalizadaEn" class="mini-tag">Finalizada</span>
            <span v-else-if="!detalle.entrega.iniciadaEn" class="mini-tag">Sin iniciar</span>
          </p>
          <p class="cuenta">
            {{ detalle.entrega.folio }} · {{ detalle.entrega.pedidos }} pedido(s) ·
            {{ detalle.entrega.recolectados }} en el camión · {{ detalle.entrega.enRuta }} en ruta ·
            {{ detalle.entrega.entregados }}
            entregado(s)
          </p>
          <p v-if="avisoBloqueo" class="bloqueo">{{ avisoBloqueo }}</p>
        </div>

        <!-- Lo que arranca y cierra esta entrega, y solo esta: cada viaje va por su lado. -->
        <div v-if="detalle.abierta" class="acciones">
          <button
            v-if="sinIniciar"
            type="button"
            class="btn-primary"
            :disabled="cerrando"
            @click="iniciar"
          >
            Iniciar entrega
          </button>
          <button
            v-else
            type="button"
            class="btn-secondary"
            :disabled="cerrando"
            @click="finalizarOReanudar"
          >
            {{ porReanudar ? 'Reanudar entrega' : 'Finalizar entrega' }}
          </button>
        </div>
      </header>

      <!-- Los KPIs son de esta entrega, no del día: cada viaje lleva los suyos. -->
      <KpisRuta :indicadores="indicadores" />

      <!-- Lo que va en el camión, por producto: lo que subió, lo que se quedó con
           los clientes y la devolución que sigue arriba (y regresa en el corte). -->
      <section v-if="viendoCamion" class="camion" aria-live="polite">
        <p class="camion-titulo">🚚 Tu camión en esta entrega</p>
        <p v-if="detalle.pedidos.length === 0" class="camion-vacio">
          Esta entrega todavía no tiene pedidos.
        </p>
        <table v-else-if="camion.length > 0" class="camion-tabla">
          <thead>
            <tr>
              <th>Producto</th>
              <th class="num">Recolectado</th>
              <th class="num">Entregado</th>
              <th class="num">Devolución</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="producto in camion" :key="producto.productoId">
              <td>
                {{ producto.nombre }} <span class="camion-unidad">{{ producto.unidad }}</span>
              </td>
              <td class="num">{{ producto.recolectado }}</td>
              <td class="num">{{ producto.entregado }}</td>
              <td class="num">
                <strong :class="{ arriba: producto.diferencia > 0 }">
                  {{ producto.diferencia }}
                </strong>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="camion-vacio">Los pedidos de esta entrega todavía no suben al camión.</p>
      </section>

      <!-- Los pedidos de esta entrega, con el paso que les toca. -->
      <p class="seccion">Pedidos de esta entrega</p>
      <div v-if="detalle.pedidos.length > 0" class="tabla-envoltorio">
        <table class="tabla lineal dos-fijas">
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Colonia</th>
              <th>Cliente</th>
              <th>Fecha</th>
              <th>Estado</th>
              <th class="num">Total</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="pedido in detalle.pedidos" :key="pedido.id">
              <tr :class="{ 'con-detalle': abierto === pedido.id }">
                <td>
                  <!-- Como en Operaciones: la flecha despliega el detalle debajo; el folio sigue
                       abriendo la hoja del pedido con sus pasos. -->
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
                  <button type="button" class="folio abre-hoja" @click="enHoja = pedido.id">
                    {{ pedido.folio }}
                  </button>
                </td>
                <td>{{ colonia(pedido) }}</td>
                <td>{{ pedido.clienteNombre ?? '—' }}</td>
                <td>{{ fechaNumerica(pedido.creadoEn) }}</td>
                <td>
                  <span class="mini-tag">
                    {{ nombreEstadoPedido(pedido.estado, pedido.pago.estado) }}
                  </span>
                </td>
                <td class="num importe">{{ dinero(pedido.total) }}</td>
                <td class="accion">
                  <div class="en-linea">
                    <template v-if="pedido.estado === 'RECOLECTADO'">
                      <button
                        type="button"
                        class="btn-primary"
                        :disabled="!puedeMover || pedido.paso.bloqueo !== null || moviendo !== null"
                        @click="enRuta(pedido)"
                      >
                        {{ moviendo === pedido.id ? '…' : TITULO_PASO.EN_RUTA }}
                      </button>
                      <button
                        type="button"
                        class="btn-cancel"
                        :disabled="!puedeCargar || moviendo !== null"
                        title="Lo baja del camión: vuelve a bodega"
                        @click="quitar(pedido)"
                      >
                        Quitar
                      </button>
                    </template>
                    <template v-else-if="pedido.estado === 'EN_RUTA'">
                      <button
                        type="button"
                        class="btn-primary"
                        :disabled="!puedeMover || pedido.paso.bloqueo !== null || moviendo !== null"
                        @click="enHoja = pedido.id"
                      >
                        {{ pedido.paso.bloqueo ? '🔒 ' : '' }}{{ TITULO_PASO.ENTREGADO }}
                      </button>
                      <button
                        type="button"
                        class="btn-cancel"
                        :disabled="!puedeMover || moviendo !== null"
                        @click="noEntregando = pedido"
                      >
                        No entregado
                      </button>
                    </template>
                    <p v-else-if="pedido.estado === 'ENTREGADO'" class="aviso hecho">✓ Entregado</p>
                  </div>
                  <p v-if="pedido.paso.bloqueo" class="bloqueo">
                    {{ pedido.paso.bloqueo.mensaje }}
                  </p>
                </td>
              </tr>
              <tr v-if="abierto === pedido.id" class="fila-detalle">
                <td colspan="7"><DetallePedidoRuta :pedido="pedido" /></td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p v-else class="empty-block">Todavía no tiene pedidos: agrégale de los de abajo.</p>

      <!-- Lo que espera en bodega: «Recolectado» lo sube a esta entrega. -->
      <template v-if="detalle.abierta">
        <p class="seccion">Pedidos pendientes por asignar</p>
        <div v-if="detalle.disponibles.length > 0" class="tabla-envoltorio">
          <table class="tabla lineal dos-fijas">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Colonia</th>
                <th>Cliente</th>
                <th>Fecha</th>
                <th class="num">Total</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="pedido in detalle.disponibles" :key="pedido.id">
                <tr :class="{ 'con-detalle': abierto === pedido.id }">
                  <td>
                    <!-- Como en Operaciones: la flecha despliega el detalle debajo; el folio sigue
                         abriendo la hoja del pedido con sus pasos. -->
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
                    <button type="button" class="folio abre-hoja" @click="enHoja = pedido.id">
                      {{ pedido.folio }}
                    </button>
                  </td>
                  <td>{{ colonia(pedido) }}</td>
                  <td>{{ pedido.clienteNombre ?? '—' }}</td>
                  <td>{{ fechaNumerica(pedido.creadoEn) }}</td>
                  <td class="num importe">{{ dinero(pedido.total) }}</td>
                  <td class="accion">
                    <button
                      type="button"
                      class="btn-primary"
                      :disabled="!puedeCargar || pedido.paso.bloqueo !== null || moviendo !== null"
                      @click="recolectar(pedido)"
                    >
                      <template v-if="moviendo === pedido.id">…</template>
                      <template v-else>
                        {{ pedido.paso.bloqueo ? '🔒 ' : '' }}{{ TITULO_PASO.RECOLECTADO }}
                      </template>
                    </button>
                    <p v-if="pedido.paso.bloqueo" class="bloqueo">
                      {{ pedido.paso.bloqueo.mensaje }}
                    </p>
                  </td>
                </tr>
                <tr v-if="abierto === pedido.id" class="fila-detalle">
                  <td colspan="6"><DetallePedidoRuta :pedido="pedido" /></td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <p v-else class="empty-block">No hay pedidos esperando camión. 🎉</p>
      </template>
    </template>

    <EntregaModal
      v-if="entregando"
      :key="`${entregando.id}-${entregando.estado}`"
      :pedido="entregando"
      :puede-mover="puedeMover"
      :puede-cargar="puedeCargar"
      recolectar-aqui
      :moviendo="moviendo !== null"
      @cerrar="enHoja = null"
      @entregado="alEntregar"
      @incidencia="reportarIncidencia"
      @paso="pasoDesdeHoja"
    />
    <NoEntregadoModal
      v-if="noEntregando"
      :pedido="noEntregando"
      @cerrar="noEntregando = null"
      @guardado="alNoEntregar"
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

.cabeza {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
  background: var(--white);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
  border-left: 4px solid var(--verde);
  padding: 12px 14px;
  margin-bottom: 14px;
}

.cabeza.cerrada {
  border-left-color: var(--line);
}

.cabeza .datos {
  flex: 1 1 240px;
  min-width: 0;
}

.cabeza .acciones {
  display: flex;
  gap: 8px;
  flex: 1 1 320px;
}

.cabeza .acciones button {
  flex: 1;
  padding: 9px 8px;
  font-size: 12px;
}

.cabeza .titulo {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 15px;
  color: var(--ink);
}

.cabeza .cuenta {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--muted);
}

/* El camioncito va sobre la barra naranja: blanco, y relleno cuando está abierto. */
.boton-camion {
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

.boton-camion.activa {
  background: var(--white);
  color: var(--orange-dark);
}

/* El inventario: con su propio scroll para no comerse la pantalla. */
.camion {
  max-height: 40vh;
  overflow-y: auto;
  margin: 0 0 14px;
  padding: 10px 14px;
  background: var(--white);
  border: 1.5px solid var(--verde);
  border-radius: var(--radius-md);
  font-size: 12.5px;
  color: var(--ink);
}

.camion-titulo {
  margin: 0 0 6px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13px;
}

.camion-tabla {
  width: 100%;
  border-collapse: collapse;
}

.camion-tabla th {
  padding: 4px 6px;
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--muted);
  text-align: left;
  border-bottom: 1px solid var(--line);
}

.camion-tabla td {
  padding: 5px 6px;
  border-bottom: 1px dashed var(--line);
}

.camion-tabla .num {
  text-align: right;
  white-space: nowrap;
}

.camion-unidad {
  font-size: 11px;
  color: var(--muted);
}

/* Lo que sigue arriba es lo que hay que cuidar: en naranja. */
.camion-tabla .arriba {
  color: var(--orange-dark);
}

.camion-vacio {
  margin: 0;
  color: var(--muted);
}

.seccion {
  margin: 0 0 6px;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  color: var(--ink);
}

/* Entre una sección y el título de la siguiente, el mismo respiro corto. */
.tabla-envoltorio {
  margin-bottom: 14px;
}

.tabla {
  min-width: 820px;
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

/* El vacío global trae 30px por arriba: aquí va pegado a su título, como la tabla. */
.empty-block {
  margin: 0 0 14px;
  padding: 12px 0;
}

/* Lo último de la pantalla no deja hueco abajo. */
.pantalla > :last-child {
  margin-bottom: 0;
}
</style>
