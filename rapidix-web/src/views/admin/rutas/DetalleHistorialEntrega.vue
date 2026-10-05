<script setup lang="ts">
/**
 * Una entrega desplegada en el historial: cómo le fue (los mismos KPIs que en
 * Liquidación), en qué quedó su dinero, el único botón de dinero que le toca y
 * lo que salió en ella, con el mismo detalle de pedido que al liquidar.
 *
 * Los tres botones son trámites distintos y **nunca salen juntos**
 * (`accionDelCorte`): antes de que Finanzas acepte el dinero se corrige lo
 * declarado (se pisa, es una corrección); con la entrega aceptada y adeudo se
 * entrega más dinero, en partes si hace falta; y mientras Finanzas no acepte
 * esa entrega de dinero, se puede cancelar para hacerla otra vez.
 *
 * Lo que Finanzas no ha aceptado **no baja el adeudo**: se dice aparte, con lo
 * que el corte espera (`esperaDelCorte`), para que no parezca dinero perdido.
 *
 * El detalle se pide al desplegar, no con la lista. La entrega ya liquidada se
 * guarda y no se vuelve a pedir; la que sigue viva cambia y se relee cada vez.
 * Los KPIs y los pedidos completos son un extra: si no llegan, van «—» y los
 * renglones del camión, y el dinero se consulta igual.
 */
import { computed, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fechaHora, fechaNumerica } from '@/utils/formato'
import DetallePedidoRuta from './DetallePedidoRuta.vue'
import KpisRuta from './KpisRuta.vue'
import TablaConteo from './TablaConteo.vue'
import { nombreMotivo } from './etiquetas'
import {
  abonoPendiente,
  accionDelCorte,
  centavos,
  errorDelAbono,
  errorDelDeclarado,
  esperaDelCorte,
  estadoEnHistorial,
  faltanteDe,
  montoCapturado,
  nombreResultado,
} from './liquidacion'
import type {
  Corte,
  DetalleEntregaRuta,
  DetalleHistorial,
  EntregaEnHistorial,
  IndicadoresRuta,
  PedidoEnHistorial,
  PedidoEnRuta,
} from '@/api/tipos'

const props = defineProps<{
  entrega: EntregaEnHistorial
  /** Lo que ya se pidió antes, si la entrega está liquidada. */
  guardado: DetalleHistorial | null
}>()

const emit = defineEmits<{
  (e: 'guardar', detalle: DetalleHistorial): void
  (e: 'corte', corte: Corte): void
}>()

const ui = useUiStore()

const detalle = ref<DetalleHistorial | null>(null)
const cargando = ref(false)
const error = ref('')
/** El pedido con sus renglones a la vista. Abrirlo no pide nada: ya vienen. */
const abierto = ref<string | null>(null)

/** Los KPIs de la entrega, los mismos que en Liquidación. `null` pinta «—». */
const indicadores = ref<IndicadoresRuta | null>(null)

/**
 * El pedido completo, para el mismo detalle que abre la flecha en Liquidación.
 * Solo los que siguen atados a la entrega: el que regresó a bodega ya no
 * apunta a ella y enseña sus renglones del camión.
 */
const completos = ref(new Map<string, PedidoEnRuta>())

const corte = computed(() => props.entrega.corte)
const accion = computed(() => accionDelCorte(corte.value))
const faltante = computed(() => (corte.value ? faltanteDe(corte.value) : 0))
const pendiente = computed(() => (corte.value ? abonoPendiente(corte.value) : null))

/** Qué falta que Finanzas acepte, dicho al repartidor. Vacío si no espera nada. */
const espera = computed(() => {
  const c = corte.value
  if (!c) return ''
  switch (esperaDelCorte(c)) {
    case 'devolucion':
      return 'Finanzas todavía no acepta tu devolución.'
    case 'dinero':
      return 'Finanzas todavía no acepta tu dinero.'
    case 'entrega':
      return 'Falta que Finanzas dé la entrega por aceptada.'
    case 'abono':
      return `Entregaste ${dinero(pendiente.value?.monto ?? 0)}: falta que Finanzas lo acepte.`
    default:
      return ''
  }
})

const fechas = computed(() => {
  const e = props.entrega
  const partes: string[] = [e.folio]
  if (e.iniciadaEn) partes.push(`Inició el ${fechaNumerica(e.iniciadaEn)}`)
  else partes.push(`Creada el ${fechaNumerica(e.creadoEn)}`)
  partes.push(`${e.pedidos} pedido(s)`)
  if (corte.value) partes.push(`liquidada el ${fechaNumerica(corte.value.cerradoEn)}`)
  return partes.join(' · ')
})

/** Los KPIs y los pedidos completos. Que fallen no impide ver el dinero. */
function cargarComoLiquidacion(): void {
  const id = props.entrega.id
  void http
    .get<IndicadoresRuta>(`/admin/rutas/entregas/${id}/indicadores`)
    .then((respuesta) => (indicadores.value = respuesta))
    .catch(() => {})
  void http
    .get<DetalleEntregaRuta>(`/admin/rutas/entregas/${id}`)
    .then((respuesta) => (completos.value = new Map(respuesta.pedidos.map((p) => [p.id, p]))))
    .catch(() => {})
}

onMounted(async () => {
  cargarComoLiquidacion()
  if (props.guardado && corte.value) {
    detalle.value = props.guardado
    return
  }
  cargando.value = true
  try {
    detalle.value = await http.get<DetalleHistorial>(
      `/admin/rutas/entregas/${props.entrega.id}/historial`,
    )
    if (corte.value) emit('guardar', detalle.value)
  } catch (fallo) {
    error.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos cargar lo que salió.'
  } finally {
    cargando.value = false
  }
})

function parcial(pedido: PedidoEnHistorial): boolean {
  return pedido.renglones.some((r) => r.recibido !== null && r.recibido < r.cantidad)
}

// ------------------------------------------------------------------
// Corregir, entregar dinero y cancelarlo
// ------------------------------------------------------------------

const dialogo = ref<'corregir' | 'completar' | null>(null)
const monto = ref('')
const errorMonto = ref('')
const guardando = ref(false)

function abrir(tipo: 'corregir' | 'completar'): void {
  if (!corte.value) return
  // Corregir parte de lo declarado; entregar, del adeudo entero, que es lo normal.
  monto.value = String(tipo === 'corregir' ? corte.value.montoDeclarado : faltante.value)
  errorMonto.value = ''
  dialogo.value = tipo
}

async function guardar(): Promise<void> {
  const c = corte.value
  if (!c || !dialogo.value) return
  errorMonto.value =
    dialogo.value === 'corregir'
      ? errorDelDeclarado(monto.value)
      : errorDelAbono(monto.value, faltante.value)
  if (errorMonto.value) return

  guardando.value = true
  try {
    const actualizado =
      dialogo.value === 'corregir'
        ? await http.patch<Corte>(`/admin/rutas/cortes/${c.id}`, {
            montoDeclarado: montoCapturado(monto.value),
          })
        : await http.post<Corte>(`/admin/rutas/cortes/${c.id}/abonos`, {
            monto: montoCapturado(monto.value),
          })
    ui.exito(
      dialogo.value === 'corregir'
        ? 'Corregiste lo que declaraste.'
        : 'Entrega de dinero registrada. Cuenta contra tu adeudo cuando Finanzas la acepte.',
    )
    dialogo.value = null
    emit('corte', actualizado)
  } catch (fallo) {
    // Un 409 aquí es que Finanzas lo aceptó entre medias o que el adeudo cambió.
    errorMonto.value = fallo instanceof ErrorApi ? fallo.message : 'No se pudo guardar.'
  } finally {
    guardando.value = false
  }
}

/** Cancela la entrega de dinero que Finanzas todavía no acepta: el dinero sigue siendo suyo. */
async function cancelarAbono(): Promise<void> {
  const c = corte.value
  const abono = pendiente.value
  if (!c || !abono || guardando.value) return

  guardando.value = true
  try {
    const actualizado = await http.delete<Corte>(`/admin/rutas/cortes/${c.id}/abonos/${abono.id}`)
    ui.exito('Entrega de dinero cancelada.')
    emit('corte', actualizado)
  } catch (fallo) {
    // 409 `ABONO_YA_ACEPTADO`: Finanzas la aceptó mientras tanto.
    ui.errorDeApi(fallo)
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <div class="detalle-historial">
    <p class="estado">{{ estadoEnHistorial(entrega) }}</p>
    <p class="fechas">{{ fechas }}</p>

    <!-- Cómo le fue a la entrega: las mismas tarjetas que en Liquidación. -->
    <KpisRuta :indicadores="indicadores" />

    <!-- Los montos, en el mismo orden siempre; cada renglón solo si tiene algo que decir. -->
    <div v-if="corte" class="montos">
      <div class="linea">
        <span>Según el sistema</span><strong>{{ dinero(corte.montoCalculado) }}</strong>
      </div>
      <div class="linea">
        <span>Declaraste</span><strong>{{ dinero(corte.montoDeclarado) }}</strong>
      </div>
      <p v-if="centavos(corte.diferencia) !== 0" class="dif alerta">
        Diferencia de {{ dinero(Math.abs(corte.diferencia)) }}
        {{ corte.diferencia > 0 ? 'a favor de la empresa' : 'a tu favor' }}.
      </p>
      <p v-else class="dif ok">✓ Cuadró con lo calculado.</p>

      <div v-if="corte.montoRecibido !== null" class="linea">
        <span>Finanzas aceptó</span><strong>{{ dinero(corte.montoRecibido) }}</strong>
      </div>

      <!-- Lo que entregó después, una por una: la que no está aceptada todavía no cuenta. -->
      <table v-if="corte.abonos.length > 0" class="tabla-lineas abonos">
        <thead>
          <tr>
            <th>Entregaste después</th>
            <th>Estatus</th>
            <th class="num">Monto</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="abono in corte.abonos" :key="abono.id">
            <td>{{ fechaHora(abono.creadoEn) }}</td>
            <td>{{ abono.aceptadoEn ? 'Aceptado' : 'Por aceptar' }}</td>
            <td class="num">{{ dinero(abono.monto) }}</td>
          </tr>
        </tbody>
      </table>

      <template v-if="corte.recibidoEn">
        <div class="linea adeudo">
          <span>Adeudo</span><strong>{{ dinero(faltante) }}</strong>
        </div>
        <p v-if="faltante > 0" class="dif alerta">Debes {{ dinero(faltante) }} de esta entrega.</p>
        <p v-else class="dif ok">✓ No debes nada de esta entrega.</p>
      </template>
      <p v-if="espera" class="dif">⏳ {{ espera }}</p>

      <p v-if="corte.notas" class="nota">📝 {{ corte.notas }}</p>
    </div>
    <p v-else class="sin-liquidar">Todavía no la liquidas: el arqueo aparece al cerrar el corte.</p>

    <button
      v-if="accion === 'corregir'"
      type="button"
      class="btn-secondary accion"
      @click="abrir('corregir')"
    >
      ✎ Corregir lo que declaré
    </button>
    <button
      v-else-if="accion === 'completar'"
      type="button"
      class="btn-primary accion"
      @click="abrir('completar')"
    >
      ＋ Entregar dinero
    </button>
    <button
      v-else-if="accion === 'cancelar' && pendiente"
      type="button"
      class="btn-secondary accion"
      :disabled="guardando"
      @click="cancelarAbono"
    >
      ✕ Cancelar la entrega de {{ dinero(pendiente.monto) }}
    </button>

    <!-- Lo que salió en ella. Se pidió al desplegar. -->
    <div class="salio">
      <p v-if="cargando" class="nota-gris">Cargando lo que salió…</p>
      <p v-else-if="error" class="error-bloque">{{ error }}</p>
      <template v-else-if="detalle">
        <p class="seccion-titulo">Pedidos que salieron ({{ detalle.pedidos.length }})</p>
        <table v-if="detalle.pedidos.length > 0" class="tabla-lineas pedidos">
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>Resultado</th>
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="pedido in detalle.pedidos" :key="pedido.id">
              <tr>
                <td>
                  <button
                    type="button"
                    class="folio-boton"
                    :aria-expanded="abierto === pedido.id"
                    @click="abierto = abierto === pedido.id ? null : pedido.id"
                  >
                    <span class="chev" :class="{ girado: abierto === pedido.id }">▾</span>
                    {{ pedido.folio }}
                  </button>
                </td>
                <td class="cliente">{{ pedido.clienteNombre }}</td>
                <td>
                  <span class="mini-tag" :class="{ mal: parcial(pedido) }">
                    {{ nombreResultado(pedido.resultado) }}
                  </span>
                </td>
                <td class="num">{{ dinero(pedido.total) }}</td>
              </tr>
              <tr v-if="abierto === pedido.id" class="renglones">
                <td colspan="4">
                  <!-- El mismo detalle que en Liquidación, si el pedido sigue en la entrega. -->
                  <DetallePedidoRuta
                    v-if="completos.has(pedido.id)"
                    :pedido="completos.get(pedido.id)!"
                  />
                  <table v-else class="tabla-lineas">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th class="num">Cantidad</th>
                        <th class="num">Recibido</th>
                        <th>Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(renglon, i) in pedido.renglones"
                        :key="i"
                        :class="{
                          corto: renglon.recibido !== null && renglon.recibido < renglon.cantidad,
                        }"
                      >
                        <td>
                          {{ renglon.nombre }} <span class="unidad">{{ renglon.unidad }}</span>
                        </td>
                        <td class="num">{{ renglon.cantidad }}</td>
                        <!-- Sin dato no es cero: el pedido todavía no cierra. -->
                        <td class="num recibido">{{ renglon.recibido ?? '—' }}</td>
                        <td>{{ renglon.motivo ? nombreMotivo(renglon.motivo) : '—' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <p v-else class="nota-gris">No hay renglones del camión guardados para esta entrega.</p>

        <template v-if="detalle.conteo.length > 0">
          <p class="seccion-titulo">Producto devuelto</p>
          <TablaConteo :conteo="detalle.conteo" />
        </template>
      </template>
    </div>

    <!-- Corregir o entregar dinero: un solo campo y lo que el sistema calculó a la vista. -->
    <div v-if="dialogo && corte" class="modal-overlay" @click.self="dialogo = null">
      <div
        class="modal-sheet"
        role="dialog"
        :aria-label="dialogo === 'corregir' ? 'Corregir lo declarado' : 'Entregar dinero'"
      >
        <div class="modal-handle" />
        <p class="modal-title">
          {{ dialogo === 'corregir' ? 'Corregir lo que declaré' : 'Entregar dinero' }}
        </p>
        <p class="modal-texto">
          <template v-if="dialogo === 'corregir'">
            El sistema calculó {{ dinero(corte.montoCalculado) }}. Lo que escribas reemplaza lo que
            declaraste: puedes corregirlo mientras Finanzas no lo acepte.
          </template>
          <template v-else>
            Debes {{ dinero(faltante) }}. Puedes entregarlo en partes, una a la vez: cada una baja
            tu adeudo cuando Finanzas la acepta.
          </template>
        </p>
        <div class="zona-captura">
          <label class="form-label" for="monto-corte">
            {{ dialogo === 'corregir' ? 'Efectivo que entrego' : 'Monto que entrego ahora' }}
          </label>
          <input
            id="monto-corte"
            v-model="monto"
            class="form-input monto"
            :class="{ 'is-invalid': errorMonto }"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            enterkeyhint="done"
            placeholder="0.00"
            @keyup.enter="guardar"
          />
          <p v-if="errorMonto" class="form-error">{{ errorMonto }}</p>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-cancel" :disabled="guardando" @click="dialogo = null">
            Volver
          </button>
          <button type="button" class="btn-primary" :disabled="guardando" @click="guardar">
            {{ guardando ? 'Guardando…' : dialogo === 'corregir' ? 'Corregir' : 'Registrar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.estado {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ink);
}

.fechas {
  margin: 2px 0 8px;
  font-size: 12px;
  color: var(--muted);
}

.montos {
  background: var(--white);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
}

.linea {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: var(--ink);
  padding: 2px 0;
}

.dif {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--muted);
}

.dif.ok {
  color: var(--verde-dark);
  font-weight: 600;
}

.dif.alerta {
  color: var(--orange-dark);
  font-weight: 600;
}

.linea.adeudo {
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid var(--line);
}

.abonos {
  margin: 6px 0;
}

.nota {
  margin: 8px 0 0;
  padding: 6px 9px;
  font-size: 12px;
  color: var(--ink);
  background: var(--cream-2);
  border-left: 3px solid var(--line);
  border-radius: 0 6px 6px 0;
  white-space: pre-wrap;
}

.sin-liquidar,
.nota-gris {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
}

.accion {
  display: block;
  width: 100%;
  margin-top: 10px;
  padding: 9px 8px;
  font-size: 12.5px;
}

.salio {
  margin-top: 12px;
  padding-top: 4px;
  border-top: 1px dashed var(--line);
}

.pedidos .cliente {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folio-boton {
  background: none;
  border: none;
  padding: 0;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 12px;
  color: var(--verde-compra);
  cursor: pointer;
  white-space: nowrap;
}

.chev {
  display: inline-block;
  color: var(--muted);
  transition: transform 0.15s;
}

.chev.girado {
  transform: rotate(180deg);
}

.mini-tag {
  white-space: nowrap;
  color: var(--ink);
}

.mini-tag.mal {
  color: var(--rojo);
}

.renglones > td {
  padding: 4px 0 8px 14px;
}

/* El renglón que el cliente no aceptó completo es justo lo que se viene a buscar. */
tr.corto td {
  background: color-mix(in srgb, var(--rojo) 7%, var(--white));
}

tr.corto .recibido {
  color: var(--rojo);
  font-weight: 700;
}

.unidad {
  font-size: 11px;
  color: var(--muted);
}

.modal-texto {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.45;
}

.zona-captura {
  background: var(--cream-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  margin-bottom: 12px;
}

/* 16px reales: con menos, Safari en iPhone amplía la página al enfocar el campo. */
.monto {
  font-size: 16px;
  font-weight: 700;
  text-align: right;
  background: var(--white);
}

.form-error {
  margin: 6px 0 0;
}
</style>
