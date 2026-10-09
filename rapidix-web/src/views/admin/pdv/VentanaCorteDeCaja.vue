<script setup lang="ts">
/**
 * PDV → Corte de caja: el cierre del turno.
 *
 * Arriba, el turno abierto: los ingresos del turno —lo que suman los pedidos
 * que se entregaron y se cobraron en el mostrador— con el campo donde el
 * cajero escribe el efectivo que contó justo debajo, para contar contra la
 * cifra; los productos que entregó sumados, y la tabla de esos pedidos —de
 * donde se entrega el que se confirmó y se soltó de la caja, y donde la flecha
 * despliega su detalle—. Abajo, los turnos ya cortados.
 *
 * El corte no acaba aquí: lo acepta Finanzas (Finanzas → Cortes), y hasta
 * entonces su efectivo no está en Ingresos. Por eso cada turno cortado dice en
 * qué va y lleva, como mucho, un botón de dinero (`accionDe`), los mismos que
 * el repartidor en su liquidación: corregir lo declarado mientras Finanzas no
 * lo acepte, entregar más dinero si quedó adeudo, o cancelar esa entrega
 * mientras siga sin aceptar.
 *
 * Los totales los da la API. El PDV cobra de contado, así que un pedido a
 * domicilio capturado en el turno también suma a esta caja: Rutas solo lo lleva.
 */
import { computed, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import {
  dinero,
  fechaHora,
  fechaNumerica,
  nombreEstadoPago,
  nombreEstadoPedido,
} from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import {
  centavos,
  errorDelAbono,
  errorDelDeclarado,
  lineaDelArqueo,
  montoCapturado,
} from '../rutas/liquidacion'
import type { AbonoDelCorte, Pedido, Tienda, TurnoPdv, TurnoPdvConPedidos } from '@/api/tipos'

/** La tienda desde la que se mira el PDV: el turno y los cortes son los suyos. */
const props = defineProps<{ tienda: Tienda }>()

const ui = useUiStore()

const turnos = ref<TurnoPdv[]>([])
const cargando = ref(true)
const error = ref('')

/** Un campo `number` devuelve número al escribir y cadena vacía al borrarlo. */
const declarado = ref<number | string>('')
const notas = ref('')
const errorCorte = ref('')
const cortando = ref(false)
const entregando = ref('')
/** El pedido con el detalle desplegado: uno a la vez, como en Finanzas. */
const detalleDe = ref<string | null>(null)

function alternar(id: string): void {
  detalleDe.value = detalleDe.value === id ? null : id
}

/** El abierto de quien mira. El administrador ve también los de otros cajeros, en la tabla. */
const abierto = ref<TurnoPdvConPedidos | null>(null)
const cerrados = computed(() => turnos.value.filter((t) => t.id !== abierto.value?.id))

/** Lo que el cajero lleva escrito, o `null` si el campo está vacío. */
const capturado = computed(() => montoCapturado(declarado.value))

/** Faltan, sobran o cuadra: cambia con cada tecla y no impide cortar. */
const arqueo = computed(() =>
  abierto.value ? lineaDelArqueo(abierto.value.totales.efectivo, capturado.value) : null,
)

/** El corte se puede hacer en cuanto hay un efectivo escrito y nada por entregar. */
const puedeCortar = computed(
  () =>
    abierto.value !== null &&
    abierto.value.totales.porEntregar === 0 &&
    capturado.value !== null &&
    capturado.value >= 0,
)

onMounted(cargar)

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    const [mio, todos] = await Promise.all([
      http.get<TurnoPdvConPedidos | null>(`/admin/pdv/turnos/abierto?tiendaId=${props.tienda.id}`),
      http.get<TurnoPdv[]>(`/admin/pdv/turnos?tiendaId=${props.tienda.id}`),
    ])
    abierto.value = mio
    turnos.value = todos
  } catch (fallo) {
    error.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos cargar los turnos.'
  } finally {
    cargando.value = false
  }
}

async function hacerCorte(): Promise<void> {
  if (!abierto.value) return
  errorCorte.value = ''
  const efectivo = capturado.value
  if (efectivo === null || efectivo < 0) {
    errorCorte.value = 'Escribe el efectivo que contaste en caja.'
    return
  }
  // Negativo: entrega menos de lo que dice el sistema. Se dice antes y después.
  const diferencia = centavos(efectivo - abierto.value.totales.efectivo)
  const falta = diferencia < 0 ? ` Faltan ${dinero(-diferencia)}.` : ''
  if (
    !confirm(
      `¿Hacer el corte de caja del turno ${abierto.value.folio}?${falta} Ya no se le podrán agregar pedidos.`,
    )
  ) {
    return
  }
  cortando.value = true
  try {
    await http.post(`/admin/pdv/turnos/${abierto.value.id}/corte`, {
      efectivoDeclarado: efectivo,
      ...(notas.value.trim() && { notas: notas.value.trim() }),
    })
    ui.exito(
      `Corte de caja del turno ${abierto.value.folio} hecho: falta que Finanzas lo acepte.${falta}`,
    )
    declarado.value = ''
    notas.value = ''
    await cargar()
  } catch (fallo) {
    errorCorte.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos hacer el corte.'
  } finally {
    cortando.value = false
  }
}

function porEntregar(pedido: Pedido): boolean {
  return (
    pedido.metodoEntrega === 'TIENDA' &&
    pedido.estado !== 'ENTREGADO' &&
    pedido.pago.estado !== 'CANCELADO'
  )
}

/** Entregar desde la tabla: el pedido que se confirmó y se soltó de la caja. */
async function entregar(pedido: Pedido): Promise<void> {
  // Lo normal es que ya venga pagado desde que se confirmó: solo se entrega.
  const pregunta =
    pedido.pago.saldo > 0
      ? `¿Entregar y cobrar el pedido ${pedido.folio} (${dinero(pedido.pago.saldo)})?`
      : `¿Entregar el pedido ${pedido.folio}?`
  if (!confirm(pregunta)) return
  entregando.value = pedido.id
  try {
    await http.post(`/admin/pdv/pedidos/${pedido.id}/entregar`)
    ui.exito(`Pedido ${pedido.folio} entregado`)
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    entregando.value = ''
    await cargar()
  }
}

function diferencia(turno: TurnoPdv): string {
  if (turno.diferencia === null) return '—'
  if (turno.diferencia === 0) return 'Cuadra'
  return turno.diferencia > 0
    ? `Sobran ${dinero(turno.diferencia)}`
    : `Faltan ${dinero(-turno.diferencia)}`
}

// ------------------------------------------------------------------
// El dinero de un turno ya cortado
// ------------------------------------------------------------------

/** El adeudo del cajero, ya con la tolerancia. Un abono sin aceptar no lo baja. */
function adeudoDe(turno: TurnoPdv): number {
  return Math.max(0, centavos(turno.corte?.saldoPendiente ?? 0))
}

function abonoPendienteDe(turno: TurnoPdv): AbonoDelCorte | null {
  return turno.corte?.abonos.find((abono) => abono.aceptadoEn === null) ?? null
}

/** En qué va el corte, con el nombre de su pestaña en Finanzas. */
function estatusDe(turno: TurnoPdv): string {
  if (!turno.corte) return 'Abierto'
  if (turno.corte.estado === 'CERRADO') return 'Cerrado'
  return turno.corte.estado === 'ACEPTADO' ? 'Con adeudo' : 'Por aceptar'
}

type AccionDeTurno = 'corregir' | 'completar' | 'cancelar'

/**
 * El botón de dinero que le toca al turno, como mucho uno: corregir lo
 * declarado mientras Finanzas no lo acepte; después, entregar más dinero si
 * quedó adeudo, o cancelar esa entrega mientras siga sin aceptar.
 */
function accionDe(turno: TurnoPdv): AccionDeTurno | null {
  const corte = turno.corte
  if (!corte || corte.estado === 'CERRADO') return null
  if (corte.recibidoEn === null) return 'corregir'
  if (abonoPendienteDe(turno)) return 'cancelar'
  return adeudoDe(turno) > 0 ? 'completar' : null
}

const dialogo = ref<{ tipo: 'corregir' | 'completar'; turno: TurnoPdv } | null>(null)
const monto = ref('')
const errorMonto = ref('')
const guardando = ref(false)

function abrir(tipo: 'corregir' | 'completar', turno: TurnoPdv): void {
  // Corregir parte de lo declarado; entregar, del adeudo entero, que es lo normal.
  monto.value = String(tipo === 'corregir' ? (turno.efectivoDeclarado ?? 0) : adeudoDe(turno))
  errorMonto.value = ''
  dialogo.value = { tipo, turno }
}

/** La fila se cambia por la que devuelve la API: la tabla no vuelve a pedirse. */
function reemplazar(actualizado: TurnoPdv): void {
  turnos.value = turnos.value.map((t) => (t.id === actualizado.id ? actualizado : t))
}

async function guardar(): Promise<void> {
  if (!dialogo.value) return
  const { tipo, turno } = dialogo.value
  errorMonto.value =
    tipo === 'corregir'
      ? errorDelDeclarado(monto.value)
      : errorDelAbono(monto.value, adeudoDe(turno))
  if (errorMonto.value) return

  guardando.value = true
  try {
    const actualizado =
      tipo === 'corregir'
        ? await http.patch<TurnoPdv>(`/admin/pdv/turnos/${turno.id}/corte`, {
            efectivoDeclarado: montoCapturado(monto.value),
          })
        : await http.post<TurnoPdv>(`/admin/pdv/turnos/${turno.id}/abonos`, {
            monto: montoCapturado(monto.value),
          })
    ui.exito(
      tipo === 'corregir'
        ? 'Corregiste el efectivo contado.'
        : 'Entrega de dinero registrada. Cuenta contra el adeudo cuando Finanzas la acepte.',
    )
    dialogo.value = null
    reemplazar(actualizado)
  } catch (fallo) {
    // Un 409 aquí es que Finanzas lo aceptó entre medias o que el adeudo cambió.
    errorMonto.value = fallo instanceof ErrorApi ? fallo.message : 'No se pudo guardar.'
  } finally {
    guardando.value = false
  }
}

/** Cancela la entrega de dinero que Finanzas todavía no acepta. */
async function cancelarAbono(turno: TurnoPdv): Promise<void> {
  const abono = abonoPendienteDe(turno)
  if (!abono || guardando.value) return
  if (!confirm(`¿Cancelar la entrega de ${dinero(abono.monto)} del turno ${turno.folio}?`)) return

  guardando.value = true
  try {
    reemplazar(await http.delete<TurnoPdv>(`/admin/pdv/turnos/${turno.id}/abonos/${abono.id}`))
    ui.exito('Entrega de dinero cancelada.')
  } catch (fallo) {
    // 409 `ABONO_YA_ACEPTADO`: Finanzas la aceptó mientras tanto.
    ui.errorDeApi(fallo)
    await cargar()
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <div class="ventana-corte">
    <SkeletonList v-if="cargando" :cantidad="3" />

    <p v-else-if="error" class="form-error">{{ error }}</p>

    <template v-else>
      <template v-if="abierto">
        <h4>Turno abierto · {{ abierto.folio }}</h4>
        <p class="detalle-turno">
          {{ abierto.tienda.nombre }} · {{ abierto.cajero }} · abierto
          {{ fechaHora(abierto.abiertoEn) }}
        </p>

        <h4>Ingresos del turno</h4>
        <div class="tabla-envoltorio">
          <table class="tabla">
            <thead>
              <tr>
                <th>Concepto</th>
                <th class="num">Pedidos</th>
                <th class="num">Monto</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Ventas cobradas en mostrador</td>
                <td class="num">{{ abierto.totales.cobrados }}</td>
                <td class="num fuerte">{{ dinero(abierto.totales.ventas) }}</td>
              </tr>
              <tr>
                <td>Efectivo</td>
                <td />
                <td class="num fuerte">{{ dinero(abierto.totales.efectivo) }}</td>
              </tr>
              <tr>
                <td>Transferencia</td>
                <td />
                <td class="num">{{ dinero(abierto.totales.transferencia) }}</td>
              </tr>
              <tr>
                <td>Billetera electrónica</td>
                <td />
                <td class="num">{{ dinero(abierto.totales.billetera) }}</td>
              </tr>
              <tr v-if="abierto.totales.porEntregar > 0" class="pendiente">
                <td>Sin entregar</td>
                <td class="num">{{ abierto.totales.porEntregar }}</td>
                <td />
              </tr>
              <tr v-if="abierto.totales.aDomicilio > 0">
                <td>A domicilio (cobrados aquí, los entrega Rutas)</td>
                <td class="num">{{ abierto.totales.aDomicilio }}</td>
                <td />
              </tr>
              <tr v-if="abierto.totales.cancelados > 0">
                <td>Cancelados</td>
                <td class="num">{{ abierto.totales.cancelados }}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Justo bajo los ingresos: se cuenta contra la cifra de Efectivo. -->
        <div class="zona-captura">
          <label class="form-label" for="corte-efectivo">Efectivo contado en caja</label>
          <input
            id="corte-efectivo"
            v-model="declarado"
            class="form-input"
            type="number"
            min="0"
            step="0.01"
            inputmode="decimal"
            :placeholder="dinero(abierto.totales.efectivo)"
          />
          <p v-if="arqueo && capturado !== null" class="arqueo" :class="arqueo.tono">
            {{ arqueo.texto }}
          </p>
        </div>

        <!-- Lo que salió de la tienda en el turno, ya sumado por la API. -->
        <h4>Productos entregados</h4>
        <div v-if="abierto.productosEntregados.length > 0" class="tabla-envoltorio">
          <table class="tabla">
            <thead>
              <tr>
                <th>Producto</th>
                <th class="num">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="producto in abierto.productosEntregados" :key="producto.productoId">
                <td>{{ producto.nombre }}</td>
                <td class="num fuerte">
                  {{ producto.cantidad }} <span class="unidad">{{ producto.unidad }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="empty-block">Todavía no se ha entregado ningún pedido en este turno.</p>

        <h4>Pedidos del turno</h4>
        <div v-if="abierto.pedidos.length > 0" class="tabla-envoltorio">
          <table class="tabla tabla-pedidos">
            <thead>
              <tr>
                <th>Folio</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Pago</th>
                <th class="num">Total</th>
                <th>Estatus</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <template v-for="p in abierto.pedidos" :key="p.id">
                <tr :class="{ 'con-detalle': detalleDe === p.id }">
                  <td>
                    <!-- La misma flecha de Finanzas y Operaciones: abre el detalle debajo. -->
                    <button
                      type="button"
                      class="chevron"
                      :class="{ abierto: detalleDe === p.id }"
                      :aria-expanded="detalleDe === p.id"
                      :aria-label="`Detalle de ${p.folio}`"
                      @click="alternar(p.id)"
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
                    <span class="folio">{{ p.folio }}</span>
                  </td>
                  <td class="fecha">{{ fechaNumerica(p.creadoEn) }}</td>
                  <td>{{ p.clienteNombre }}</td>
                  <td>
                    {{ p.pago.metodo === 'EFECTIVO' ? 'Efectivo' : 'Transferencia' }}
                    <span class="sub">{{ nombreEstadoPago(p.pago.estado) }}</span>
                  </td>
                  <td class="num">{{ dinero(p.total) }}</td>
                  <td>
                    <span class="mini-tag">{{ nombreEstadoPedido(p.estado, p.pago.estado) }}</span>
                  </td>
                  <td class="num">
                    <button
                      v-if="porEntregar(p)"
                      type="button"
                      class="btn-primary entregar"
                      :disabled="entregando !== ''"
                      @click="entregar(p)"
                    >
                      {{ entregando === p.id ? 'Entregando…' : 'Entregado' }}
                    </button>
                  </td>
                </tr>

                <tr v-if="detalleDe === p.id" class="fila-detalle">
                  <td colspan="7">
                    <div class="detalle-pedido">
                      <table class="tabla-lineas">
                        <thead>
                          <tr>
                            <th>Producto</th>
                            <th class="num">Precio</th>
                            <th class="num">Cant.</th>
                            <th class="num">Importe</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="item in p.items" :key="item.productoId">
                            <td>{{ item.nombre }}</td>
                            <td class="num">{{ dinero(item.precioUnitario) }}</td>
                            <td class="num">{{ item.cantidad }} {{ item.unidad }}</td>
                            <td class="num">{{ dinero(item.importe) }}</td>
                          </tr>
                        </tbody>
                      </table>

                      <dl class="cuentas">
                        <div>
                          <dt>Subtotal</dt>
                          <dd>{{ dinero(p.subtotal) }}</dd>
                        </div>
                        <div v-if="p.metodoEntrega === 'DOMICILIO'">
                          <dt>Envío a domicilio</dt>
                          <dd>{{ p.envio === 0 ? 'Gratis' : dinero(p.envio) }}</dd>
                        </div>
                        <div v-if="p.descuento > 0">
                          <dt>{{ p.cupon ? `Cupón ${p.cupon.code}` : 'Descuento' }}</dt>
                          <dd>−{{ dinero(p.descuento) }}</dd>
                        </div>
                        <div class="total">
                          <dt>Total</dt>
                          <dd>{{ dinero(p.total) }}</dd>
                        </div>
                        <div v-if="p.pago.billetera > 0">
                          <dt>Pagó con su billetera</dt>
                          <dd>−{{ dinero(p.pago.billetera) }}</dd>
                        </div>
                        <div v-if="p.pago.billetera > 0">
                          <dt>{{ p.pago.metodo === 'EFECTIVO' ? 'Efectivo' : 'Transferencia' }}</dt>
                          <dd>{{ dinero(p.pago.aPagar) }}</dd>
                        </div>
                      </dl>

                      <p v-if="p.pago.pagoCon !== null && p.pago.cambio !== null" class="nota">
                        💵 Paga con {{ dinero(p.pago.pagoCon) }} · Cambio
                        {{ dinero(p.pago.cambio) }}
                      </p>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <p v-else class="empty-block">Todavía no hay pedidos en este turno.</p>

        <div class="zona-captura">
          <label class="form-label" for="corte-notas">Notas (opcional)</label>
          <input id="corte-notas" v-model="notas" class="form-input" maxlength="300" />
        </div>

        <p v-if="abierto.totales.porEntregar > 0" class="form-error">
          Hay {{ abierto.totales.porEntregar }} pedido(s) sin entregar: entrégalos en la tabla de
          arriba antes del corte.
        </p>
        <p v-if="errorCorte" class="form-error">{{ errorCorte }}</p>

        <button
          type="button"
          class="btn-primary ancho"
          :disabled="cortando || !puedeCortar"
          @click="hacerCorte"
        >
          {{ cortando ? 'Cerrando…' : 'Hacer corte de caja' }}
        </button>
      </template>
      <p v-else class="empty-block">
        No tienes un turno abierto en {{ tienda.nombre }}. Créalo en la pestaña Punto de Venta.
      </p>

      <h4>Turnos</h4>
      <div v-if="cerrados.length > 0" class="tabla-envoltorio">
        <table class="tabla tabla-turnos">
          <thead>
            <tr>
              <th>Turno</th>
              <th>Tienda</th>
              <th>Cajero</th>
              <th class="num">Pedidos</th>
              <th class="num">Ventas</th>
              <th class="num">Efectivo</th>
              <th class="num">Contado</th>
              <th>Diferencia</th>
              <th class="num">Adeudo</th>
              <th>Estatus</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in cerrados" :key="t.id">
              <td>
                <span class="folio">{{ t.folio }}</span>
                <span class="sub">{{ fechaHora(t.cerradoEn ?? t.abiertoEn) }}</span>
              </td>
              <td>{{ t.tienda.nombre }}</td>
              <td>{{ t.cajero }}</td>
              <td class="num">{{ t.totales.cobrados }}</td>
              <td class="num">{{ dinero(t.totales.ventas) }}</td>
              <td class="num">{{ dinero(t.totales.efectivo) }}</td>
              <td class="num">
                {{ t.efectivoDeclarado === null ? '—' : dinero(t.efectivoDeclarado) }}
              </td>
              <td :class="{ falta: (t.diferencia ?? 0) < 0 }">
                {{ diferencia(t) }}
                <span v-if="t.notas" class="sub">{{ t.notas }}</span>
              </td>
              <!-- Sin dinero aceptado todavía no hay contra qué medir el adeudo. -->
              <td class="num" :class="{ falta: adeudoDe(t) > 0 }">
                <template v-if="t.corte?.recibidoEn">
                  {{ adeudoDe(t) > 0 ? dinero(adeudoDe(t)) : 'Sin adeudo' }}
                </template>
                <template v-else>—</template>
              </td>
              <td>
                <span class="mini-tag">{{ estatusDe(t) }}</span>
              </td>
              <td>
                <button
                  v-if="accionDe(t) === 'corregir'"
                  type="button"
                  class="enlace"
                  @click="abrir('corregir', t)"
                >
                  Corregir efectivo
                </button>
                <button
                  v-else-if="accionDe(t) === 'completar'"
                  type="button"
                  class="enlace"
                  @click="abrir('completar', t)"
                >
                  Entregar dinero
                </button>
                <button
                  v-else-if="accionDe(t) === 'cancelar'"
                  type="button"
                  class="enlace"
                  :disabled="guardando"
                  @click="cancelarAbono(t)"
                >
                  Cancelar entrega de {{ dinero(abonoPendienteDe(t)?.monto ?? 0) }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty-block">Todavía no hay cortes de caja.</p>
    </template>

    <!-- Corregir o entregar dinero: un solo campo y lo que el sistema calculó a la vista. -->
    <div v-if="dialogo" class="modal-overlay" @click.self="dialogo = null">
      <div
        class="modal-sheet"
        role="dialog"
        :aria-label="
          dialogo.tipo === 'corregir' ? 'Corregir el efectivo contado' : 'Entregar dinero'
        "
      >
        <div class="modal-handle" />
        <p class="modal-title">
          {{ dialogo.tipo === 'corregir' ? 'Corregir el efectivo contado' : 'Entregar dinero' }}
          · {{ dialogo.turno.folio }}
        </p>
        <p class="modal-texto">
          <template v-if="dialogo.tipo === 'corregir'">
            El sistema calculó {{ dinero(dialogo.turno.totales.efectivo) }}. Lo que escribas
            reemplaza lo que se contó: se puede corregir mientras Finanzas no lo acepte.
          </template>
          <template v-else>
            Faltan {{ dinero(adeudoDe(dialogo.turno)) }}. Se puede entregar en partes, una a la vez:
            cada una baja el adeudo cuando Finanzas la acepta.
          </template>
        </p>
        <div class="zona-captura en-hoja">
          <label class="form-label" for="monto-turno">
            {{ dialogo.tipo === 'corregir' ? 'Efectivo contado en caja' : 'Monto que se entrega' }}
          </label>
          <input
            id="monto-turno"
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
            {{ guardando ? 'Guardando…' : dialogo.tipo === 'corregir' ? 'Corregir' : 'Registrar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
h4 {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13px;
  color: var(--ink);
  margin: 0 0 4px;
}

h4:not(:first-child) {
  margin-top: 20px;
  margin-bottom: 10px;
}

.detalle-turno {
  font-size: 11.5px;
  color: var(--muted);
  margin: 0 0 10px;
}

.fuerte {
  font-family: var(--font-heading);
  font-weight: 800;
}

.pendiente td,
.falta {
  color: var(--terracotta);
  font-weight: 700;
}

.zona-captura {
  background: var(--cream);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 12px 14px 2px;
  margin: 12px 0;
}

.ancho {
  width: 100%;
}

/* La línea del arqueo, bajo el campo: cuánto falta o sobra contra el sistema. */
.arqueo {
  margin: -4px 0 10px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  color: var(--muted);
}

.arqueo.ok {
  color: var(--verde-dark);
}

.arqueo.alerta {
  color: var(--terracotta);
}

.tabla-turnos {
  min-width: 940px;
}

.tabla-pedidos .fecha {
  white-space: nowrap;
}

.modal-texto {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.45;
}

.zona-captura.en-hoja {
  margin: 0 0 12px;
}

/* 16px reales: con menos, Safari en iPhone amplía la página al enfocar el campo. */
.monto {
  font-size: 16px;
  font-weight: 700;
  text-align: right;
}

.tabla-pedidos {
  min-width: 620px;
}

.entregar {
  width: auto;
  padding: 0 16px;
}

.unidad {
  font-family: var(--font-body);
  font-weight: 400;
  font-size: 10.5px;
  color: var(--muted);
}

.sub {
  display: block;
  font-size: 10.5px;
  color: var(--muted);
  margin-top: 2px;
}
</style>
