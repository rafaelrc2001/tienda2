<script setup lang="ts">
/**
 * Una entrega desplegada en el historial: en qué quedó su dinero, el único
 * botón de dinero que le toca y lo que salió en ella.
 *
 * Los dos botones son trámites distintos y **nunca salen juntos**: antes de que
 * Finanzas cuente se corrige lo declarado (se pisa, es una corrección); después
 * el arqueo ya lo firmaron dos personas y no se toca, y lo que falte se abona
 * aparte, en parcialidades si hace falta.
 *
 * El detalle se pide al desplegar, no con la lista. La entrega ya liquidada se
 * guarda y no se vuelve a pedir; la que sigue viva cambia y se relee cada vez.
 */
import { computed, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fechaNumerica } from '@/utils/formato'
import TablaConteo from './TablaConteo.vue'
import { nombreMotivo } from './etiquetas'
import {
  accionDelCorte,
  centavos,
  errorDelAbono,
  errorDelDeclarado,
  estadoEnHistorial,
  faltanteDe,
  montoCapturado,
  nombreResultado,
} from './liquidacion'
import type { Corte, DetalleHistorial, EntregaEnHistorial, PedidoEnHistorial } from '@/api/tipos'

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

const corte = computed(() => props.entrega.corte)
const accion = computed(() => accionDelCorte(corte.value))
const faltante = computed(() => (corte.value ? faltanteDe(corte.value) : 0))
const abonado = computed(() => corte.value?.abonos.reduce((suma, a) => suma + a.monto, 0) ?? 0)
/** Lo contado contra lo declarado: la sorpresa de Finanzas al abrir la bolsa. */
const alRecibir = computed(() =>
  corte.value?.montoRecibido == null
    ? 0
    : centavos(corte.value.montoRecibido - corte.value.montoDeclarado),
)

const fechas = computed(() => {
  const e = props.entrega
  const partes: string[] = []
  if (e.iniciadaEn) partes.push(`Inició el ${fechaNumerica(e.iniciadaEn)}`)
  else partes.push(`Creada el ${fechaNumerica(e.creadoEn)}`)
  partes.push(`${e.pedidos} pedido(s)`)
  if (corte.value) partes.push(`cerró el ${fechaNumerica(corte.value.cerradoEn)}`)
  return partes.join(' · ')
})

onMounted(async () => {
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
// Corregir y completar
// ------------------------------------------------------------------

const dialogo = ref<'corregir' | 'completar' | null>(null)
const monto = ref('')
const errorMonto = ref('')
const guardando = ref(false)

function abrir(tipo: 'corregir' | 'completar'): void {
  if (!corte.value) return
  // Corregir parte de lo declarado; completar, del faltante entero, que es lo normal.
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
        : faltanteDe(actualizado) > 0
          ? `Abono registrado. Te faltan ${dinero(faltanteDe(actualizado))}.`
          : 'Abono registrado: el faltante queda saldado.',
    )
    dialogo.value = null
    emit('corte', actualizado)
  } catch (fallo) {
    // Un 409 aquí es que Finanzas lo recibió entre medias o que el saldo cambió.
    errorMonto.value = fallo instanceof ErrorApi ? fallo.message : 'No se pudo guardar.'
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <div class="detalle-historial">
    <p class="estado">{{ estadoEnHistorial(entrega) }}</p>
    <p class="fechas">{{ fechas }}</p>

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

      <template v-if="corte.montoRecibido !== null">
        <div class="linea">
          <span>Finanzas contó</span><strong>{{ dinero(corte.montoRecibido) }}</strong>
        </div>
        <p v-if="alRecibir !== 0" class="dif alerta">
          Al recibir hubo {{ dinero(Math.abs(alRecibir)) }} {{ alRecibir < 0 ? 'menos' : 'más' }} de
          lo que declaraste.
        </p>
      </template>

      <div v-if="corte.abonos.length > 0" class="linea">
        <span>Completaste después</span><strong>{{ dinero(abonado) }}</strong>
      </div>
      <p v-if="faltante > 0" class="dif alerta">Te falta entregar {{ dinero(faltante) }}.</p>
      <p v-else-if="corte.abonos.length > 0" class="dif ok">✓ Faltante saldado.</p>

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
      ＋ Completar el faltante
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
                  <table class="tabla-lineas">
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

    <!-- Corregir o completar: un solo campo y lo que el sistema calculó a la vista. -->
    <div v-if="dialogo && corte" class="modal-overlay" @click.self="dialogo = null">
      <div
        class="modal-sheet"
        role="dialog"
        :aria-label="dialogo === 'corregir' ? 'Corregir lo declarado' : 'Completar el faltante'"
      >
        <div class="modal-handle" />
        <p class="modal-title">
          {{ dialogo === 'corregir' ? 'Corregir lo que declaré' : 'Completar el faltante' }}
        </p>
        <p class="modal-texto">
          <template v-if="dialogo === 'corregir'">
            El sistema calculó {{ dinero(corte.montoCalculado) }}. Lo que escribas reemplaza lo que
            declaraste: puedes corregirlo mientras Finanzas no lo reciba.
          </template>
          <template v-else>
            Te faltan {{ dinero(faltante) }}. Puedes entregarlo en partes: cada abono queda
            registrado aparte, con tu nombre y la hora.
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
