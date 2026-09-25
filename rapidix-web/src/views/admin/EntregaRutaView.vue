<script setup lang="ts">
/**
 * Rutas → una entrega: el viaje que se está armando o repartiendo.
 *
 * En la cabecera, lo que cierra la entrega: «Finalizar entrega» (o reanudarla)
 * y «Hacer mi corte». Son de cada entrega, no de la jornada: cada viaje se
 * cierra y se liquida por su lado.
 *
 * Arriba, los pedidos de esta entrega con el paso que les toca: «En ruta» (o
 * quitarlo mientras no haya salido), «Entregar» y «No entregado». Abajo, lo
 * que espera en bodega, con «Recolectado» para subirlo a esta entrega.
 *
 * Que un pedido no quede en dos entregas lo garantiza la API: un pedido que ya
 * va en otra ni siquiera aparece abajo, y si otro teléfono se lo llevó entre
 * medias, la API responde 409 y aquí se relee.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fechaNumerica, nombreEstadoPedido, nombreMetodoPago } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import EntregaModal from './rutas/EntregaModal.vue'
import NoEntregadoModal from './rutas/NoEntregadoModal.vue'
import CorteModal from './rutas/CorteModal.vue'
import { nombreEntrega, TITULO_PASO } from './rutas/etiquetas'
import { cobraEnEfectivo } from './rutas/cobro'
import type { DetalleEntregaRuta, EntregaRuta, PedidoEnRuta, ResultadoEntrega } from '@/api/tipos'

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
const corteAbierto = ref(false)
const cerrando = ref(false)

const entregando = computed(() => {
  if (!enHoja.value || !detalle.value) return null
  const { pedidos, disponibles } = detalle.value
  return [...pedidos, ...disponibles].find((p) => p.id === enHoja.value) ?? null
})

let peticion = 0

async function cargar(conEsqueleto = true): Promise<void> {
  const numero = ++peticion
  if (conEsqueleto) cargando.value = true
  try {
    const respuesta = await http.get<DetalleEntregaRuta>(
      `/admin/rutas/entregas/${String(route.params.id)}`,
    )
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
  () => cargar(),
)

/**
 * Se puede mover algo si la entrega sigue abierta —sin corte, de la jornada
 * viva— y no se ha finalizado. Si no, la pantalla se consulta y dice por qué.
 */
const puedeMover = computed(
  () =>
    detalle.value !== null &&
    detalle.value.abierta &&
    detalle.value.entrega.finalizadaEn === null &&
    detalle.value.jornada !== null &&
    detalle.value.jornada.finalizadaEn === null,
)

const avisoBloqueo = computed(() => {
  if (!detalle.value || puedeMover.value) return ''
  if (detalle.value.entrega.cortada) return 'Esta entrega ya tiene su corte: solo se consulta.'
  if (!detalle.value.abierta)
    return 'Esta entrega es de una jornada que ya se cortó: solo se consulta.'
  if (detalle.value.entrega.finalizadaEn)
    return 'Finalizaste esta entrega: reanúdala para moverla o haz su corte.'
  return 'Tu jornada está finalizada: reanúdala en Rutas para mover esta entrega.'
})

// ------------------------------------------------------------------
// Cerrar la entrega
// ------------------------------------------------------------------

/**
 * «Finalizar entrega» y su vuelta atrás. No exige que todo esté entregado: lo
 * que no se entregó regresa a bodega al cortarla.
 */
async function finalizarOReanudar(): Promise<void> {
  if (!detalle.value || cerrando.value) return
  const finalizar = detalle.value.entrega.finalizadaEn === null
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

/** Cerrar la hoja del corte relee: si llegó a cortar, la entrega ya solo se consulta. */
function cerrarCorte(): void {
  corteAbierto.value = false
  void cargar(false)
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

function colonia(pedido: PedidoEnRuta): string {
  const d = pedido.direccion as Record<string, string | null> | null
  return d?.colonia || '—'
}

function faltaPago(pedido: PedidoEnRuta): boolean {
  return pedido.paso.siguiente !== null && !pedido.pagoCubierto
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin/rutas" class="admin-back-inline">← Rutas</RouterLink>

    <SkeletonList v-if="cargando" :cantidad="3" />

    <template v-else-if="detalle">
      <header class="cabeza" :class="{ cerrada: !puedeMover }">
        <div class="datos">
          <p class="titulo">
            {{ nombreEntrega(detalle.entrega) }}
            <span v-if="detalle.entrega.cortada" class="mini-tag">Cortada</span>
            <span v-else-if="detalle.entrega.finalizadaEn" class="mini-tag">Finalizada</span>
          </p>
          <p class="cuenta">
            {{ detalle.entrega.pedidos }} pedido(s) · {{ detalle.entrega.recolectados }} en el
            camión · {{ detalle.entrega.enRuta }} en ruta ·
            {{ detalle.entrega.entregados }}
            entregado(s)
          </p>
          <p v-if="avisoBloqueo" class="bloqueo">{{ avisoBloqueo }}</p>
        </div>

        <!-- Lo que cierra esta entrega, y solo esta: cada viaje se liquida por su lado. -->
        <div v-if="detalle.abierta" class="acciones">
          <button
            type="button"
            class="btn-secondary"
            :disabled="cerrando"
            @click="finalizarOReanudar"
          >
            {{ detalle.entrega.finalizadaEn ? 'Reanudar entrega' : 'Finalizar entrega' }}
          </button>
          <button type="button" class="btn-secondary" @click="corteAbierto = true">
            Hacer mi corte
          </button>
        </div>
      </header>

      <!-- Los pedidos de esta entrega, con el paso que les toca. -->
      <p class="seccion">Pedidos de esta entrega</p>
      <div v-if="detalle.pedidos.length > 0" class="tabla-envoltorio">
        <table class="tabla lineal">
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Colonia</th>
              <th>Cliente</th>
              <th>Fecha</th>
              <th>Estado</th>
              <th>Cobro</th>
              <th class="num">Total</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="pedido in detalle.pedidos" :key="pedido.id">
              <td>
                <button type="button" class="folio abre-hoja" @click="enHoja = pedido.id">
                  {{ pedido.folio }} ›
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
              <td>
                <span v-if="faltaPago(pedido)" class="mini-tag falta-pago">
                  🔒 Falta pago · {{ nombreMetodoPago(pedido.pago.metodo) }}
                </span>
                <span v-else-if="cobraEnEfectivo(pedido)" class="mini-tag cobrar">
                  Cobrar {{ dinero(pedido.pago.aPagar) }}
                </span>
                <span v-else class="mini-tag pagado">
                  {{ nombreMetodoPago(pedido.pago.metodo) }} · no cobras
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
                      :disabled="!puedeMover || moviendo !== null"
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
          </tbody>
        </table>
      </div>
      <p v-else class="empty-block">Todavía no tiene pedidos: agrégale de los de abajo.</p>

      <!-- Lo que espera en bodega: «Recolectado» lo sube a esta entrega. -->
      <template v-if="detalle.abierta">
        <p class="seccion">Listos para entregar</p>
        <div v-if="detalle.disponibles.length > 0" class="tabla-envoltorio">
          <table class="tabla lineal">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Colonia</th>
                <th>Cliente</th>
                <th>Fecha</th>
                <th>Cobro</th>
                <th class="num">Total</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="pedido in detalle.disponibles" :key="pedido.id">
                <td>
                  <button type="button" class="folio abre-hoja" @click="enHoja = pedido.id">
                    {{ pedido.folio }} ›
                  </button>
                </td>
                <td>{{ colonia(pedido) }}</td>
                <td>{{ pedido.clienteNombre ?? '—' }}</td>
                <td>{{ fechaNumerica(pedido.creadoEn) }}</td>
                <td>
                  <span v-if="faltaPago(pedido)" class="mini-tag falta-pago">
                    🔒 Falta pago · {{ nombreMetodoPago(pedido.pago.metodo) }}
                  </span>
                  <span v-else-if="cobraEnEfectivo(pedido)" class="mini-tag cobrar">
                    Cobrar {{ dinero(pedido.pago.aPagar) }}
                  </span>
                  <span v-else class="mini-tag pagado">
                    {{ nombreMetodoPago(pedido.pago.metodo) }} · no cobras
                  </span>
                </td>
                <td class="num importe">{{ dinero(pedido.total) }}</td>
                <td class="accion">
                  <button
                    type="button"
                    class="btn-primary"
                    :disabled="!puedeMover || pedido.paso.bloqueo !== null || moviendo !== null"
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
    <CorteModal
      v-if="corteAbierto && detalle"
      :entrega-id="detalle.entrega.id"
      :titulo="nombreEntrega(detalle.entrega)"
      @cortado="cargar(false)"
      @cerrar="cerrarCorte"
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

.seccion {
  margin: 0 0 6px;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  color: var(--ink);
}

.tabla-envoltorio {
  margin-bottom: 16px;
}
.tabla {
  min-width: 820px;
}

.mini-tag.cobrar {
  background: var(--amarillo);
  color: var(--ink);
}

.mini-tag.pagado {
  background: var(--cream-2);
  color: var(--muted);
}

.mini-tag.falta-pago {
  background: color-mix(in srgb, var(--rojo) 15%, var(--white));
  color: var(--rojo);
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

.empty-block {
  margin-bottom: 16px;
}
</style>
