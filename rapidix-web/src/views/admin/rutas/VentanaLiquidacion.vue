<script setup lang="ts">
/**
 * Rutas → Liquidación: el corte de una entrega, al volver a bodega.
 *
 * Cada entrega se corta por su lado; con varias vivas se elige arriba cuál. Es
 * un scroll largo que acaba en «Finalizar liquidación»: primero lo que el
 * sistema dice que trae —para que cuente contra un número y no contra su
 * memoria—, luego la mercancía que baja y al final lo que él declara.
 *
 * **Que no cuadre no bloquea.** Solo el campo vacío apaga el botón: bloquear
 * al repartidor no repone el dinero, y la diferencia queda escrita para
 * Finanzas. Cerrar es también lo que descarga el camión: los pedidos que no se
 * entregaron vuelven a «Listo para entrega» y salen otro día.
 */
import { computed, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import TablaConteo from './TablaConteo.vue'
import { nombreEntrega } from './etiquetas'
import {
  centavos,
  cobroDelPedido,
  lineaDelArqueo,
  lineaDeProductos,
  montoCapturado,
} from './liquidacion'
import type { EntregaRuta, ResumenCorte, TableroRutas } from '@/api/tipos'

const props = defineProps<{
  /** La entrega que se abre al llegar, p. ej. desde «Hacer mi corte» de una entrega. */
  entregaInicial: string | null
}>()

const emit = defineEmits<{
  /** Se cerró un corte: el encabezado y la lista cambian. */
  (e: 'cortado'): void
  /** Se eligió otra entrega: la URL la recuerda. */
  (e: 'elegir', entregaId: string): void
}>()

const ui = useUiStore()

/** Las entregas sin corte de la jornada viva: son las que se pueden liquidar. */
const vivas = ref<EntregaRuta[]>([])
const elegida = ref<string | null>(null)
const resumen = ref<ResumenCorte | null>(null)
const cargando = ref(true)
const cargandoCorte = ref(false)
const error = ref('')

/** Texto y no número: el campo vacío es distinto de cero, y vacío es lo único que bloquea. */
const declarado = ref('')
const notas = ref('')
const confirmando = ref(false)
const enviando = ref(false)

const entrega = computed(() => vivas.value.find((e) => e.id === elegida.value) ?? null)

/** Las dos listas salen del mismo arreglo partido en dos: cada pedido está en una sola. */
const entregados = computed(() => resumen.value?.pedidos.filter((p) => !p.devolucion) ?? [])
const devueltos = computed(() => resumen.value?.pedidos.filter((p) => p.devolucion) ?? [])
const sinPedidos = computed(() => (resumen.value?.pedidos.length ?? 0) === 0)

const capturado = computed(() => montoCapturado(declarado.value))
const arqueo = computed(() => lineaDelArqueo(resumen.value?.montoCalculado ?? 0, capturado.value))

/** Sin pedidos no hay arqueo que capturar: se cierra en cero. */
const puedeCerrar = computed(
  () => resumen.value !== null && !enviando.value && (sinPedidos.value || capturado.value !== null),
)

let peticion = 0

onMounted(async () => {
  try {
    const tablero = await http.get<TableroRutas>('/admin/rutas', {
      query: { filtro: 'disponibles', limite: 1 },
    })
    vivas.value = tablero.entregas.filter((e) => !e.cortada)
    const inicial = vivas.value.find((e) => e.id === props.entregaInicial)
    // Sin una pedida, la primera finalizada: es la que acaba de volver.
    const porDefecto = inicial ?? vivas.value.find((e) => e.finalizadaEn) ?? vivas.value[0]
    if (porDefecto) await elegir(porDefecto.id, false)
  } catch (fallo) {
    error.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos cargar tus entregas.'
  } finally {
    cargando.value = false
  }
})

async function elegir(id: string, avisar = true): Promise<void> {
  const numero = ++peticion
  elegida.value = id
  resumen.value = null
  declarado.value = ''
  notas.value = ''
  error.value = ''
  cargandoCorte.value = true
  if (avisar) emit('elegir', id)
  try {
    const respuesta = await http.get<ResumenCorte>(`/admin/rutas/entregas/${id}/corte`)
    if (numero === peticion) resumen.value = respuesta
  } catch (fallo) {
    if (numero === peticion)
      error.value =
        fallo instanceof ErrorApi
          ? fallo.message
          : 'No pudimos calcular tu corte. Inténtalo otra vez.'
  } finally {
    if (numero === peticion) cargandoCorte.value = false
  }
}

function estadoDe(e: EntregaRuta): string {
  if (e.finalizadaEn) return 'Finalizada'
  return e.iniciadaEn ? 'En curso' : 'Sin iniciar'
}

/** El aviso del diálogo, en una sola frase: es lo que cambia lo que hace mañana. */
const fraseDeCierre = computed(() => {
  const r = resumen.value
  if (!r || !entrega.value) return ''
  const monto = sinPedidos.value ? 0 : (capturado.value ?? 0)
  const partes = [
    `Vas a liquidar ${r.pedidos.length} pedido(s) de ${nombreEntrega(entrega.value)}`,
    `entregas ${dinero(monto)} contra ${dinero(r.montoCalculado)} calculados`,
  ]
  const diferencia = centavos(monto - r.montoCalculado)
  if (diferencia !== 0) {
    partes.push(
      `⚠ estás entregando ${dinero(Math.abs(diferencia))} ${diferencia < 0 ? 'MENOS' : 'MÁS'} ` +
        'de lo calculado y la diferencia queda registrada',
    )
  }
  if (r.pedidosQueRegresan > 0) {
    partes.push(`${r.pedidosQueRegresan} pedido(s) regresan a bodega y vuelven a salir otro día`)
  }
  partes.push(
    r.cierraJornada
      ? 'esto finaliza la entrega y, como es la última abierta, también tu jornada'
      : 'esto finaliza la entrega',
  )
  return partes.join('; ') + '.'
})

async function finalizar(): Promise<void> {
  if (!elegida.value || !puedeCerrar.value) return
  enviando.value = true
  try {
    await http.post(`/admin/rutas/entregas/${elegida.value}/corte`, {
      montoDeclarado: sinPedidos.value ? 0 : capturado.value,
      // Se lee al pulsar: la nota se escribe justo antes de cerrar.
      ...(notas.value.trim() ? { notas: notas.value.trim() } : {}),
    })
    confirmando.value = false
    ui.exito('Corte cerrado. Lo encuentras en Historial mientras Finanzas lo recibe.')
    emit('cortado')
  } catch (fallo) {
    confirmando.value = false
    ui.errorDeApi(fallo)
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <div>
    <SkeletonList v-if="cargando" :cantidad="3" />

    <p v-else-if="vivas.length === 0 && !error" class="empty-block">
      No tienes entregas por liquidar. Cuando termines una, su corte se hace aquí.
    </p>

    <template v-else>
      <!-- Con varias entregas vivas, cuál se corta: cada una va por su lado. -->
      <div v-if="vivas.length > 1" class="elegir" role="tablist" aria-label="Entrega a liquidar">
        <button
          v-for="e in vivas"
          :key="e.id"
          type="button"
          role="tab"
          class="pill"
          :class="{ active: e.id === elegida }"
          :aria-selected="e.id === elegida"
          @click="elegir(e.id)"
        >
          {{ nombreEntrega(e) }} · {{ estadoDe(e) }}
        </button>
      </div>
      <p v-else-if="entrega" class="de-entrega">
        {{ nombreEntrega(entrega) }} · {{ estadoDe(entrega) }}
      </p>

      <SkeletonList v-if="cargandoCorte" :cantidad="2" />

      <p v-else-if="error" class="error-bloque">
        {{ error }}
        <button v-if="elegida" type="button" class="enlace" @click="elegir(elegida, false)">
          Reintentar
        </button>
      </p>

      <template v-else-if="resumen">
        <!-- El dinero que trae, pedido por pedido. -->
        <p class="seccion-titulo">Efectivo a liquidar ({{ entregados.length }})</p>
        <div v-if="entregados.length > 0" class="tabla-envoltorio">
          <table class="tabla lista">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Productos</th>
                <th class="num">Efectivo</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="pedido in entregados" :key="pedido.id">
                <td class="pedido">
                  <span class="folio">📦 {{ pedido.folio }}</span>
                  <span class="sub cliente">{{ pedido.clienteNombre }}</span>
                </td>
                <td class="productos">{{ lineaDeProductos(pedido) || '—' }}</td>
                <td class="num">
                  <span v-if="cobroDelPedido(pedido) === 'en-linea'" class="chip">
                    Pagado en línea
                  </span>
                  <span v-else-if="cobroDelPedido(pedido) === 'credito'" class="chip">Crédito</span>
                  <span v-else class="importe">{{ dinero(pedido.efectivo) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="vacio">Sin efectivo pendiente de entregar.</p>

        <!-- Lo que no se entregó: vuelve a bodega. Sin devoluciones, ni el título. -->
        <template v-if="devueltos.length > 0">
          <p class="seccion-titulo">
            Productos no entregados / devoluciones ({{ devueltos.length }})
          </p>
          <div class="tabla-envoltorio">
            <table class="tabla lista devoluciones">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Productos que regresan</th>
                  <th class="num"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="pedido in devueltos" :key="pedido.id">
                  <td class="pedido">
                    <span class="folio">📦 {{ pedido.folio }}</span>
                    <span class="sub cliente">{{ pedido.clienteNombre }}</span>
                  </td>
                  <td class="productos">{{ lineaDeProductos(pedido) || '—' }}</td>
                  <td class="num">
                    <span class="chip rojo">
                      {{ pedido.estadoPago === 'CANCELADO' ? 'Cancelado' : 'Devolución' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <!-- El conteo físico de lo que baja del camión. -->
        <template v-if="resumen.conteo.length > 0">
          <p class="seccion-titulo">Producto en ruta / a devolver</p>
          <TablaConteo :conteo="resumen.conteo" />
        </template>

        <!-- El arqueo: lo que dice el sistema contra lo que él entrega. -->
        <template v-if="!sinPedidos">
          <p class="seccion-titulo">Arqueo de efectivo</p>
          <div class="zona-captura">
            <div class="linea">
              <span>Según el sistema</span>
              <strong>{{ dinero(resumen.montoCalculado) }}</strong>
            </div>
            <label class="linea" for="declarado">
              <span>Efectivo que entrego</span>
              <input
                id="declarado"
                v-model="declarado"
                class="form-input monto"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                enterkeyhint="done"
                placeholder="0.00"
              />
            </label>
            <p class="diferencia" :class="arqueo.tono" aria-live="polite">{{ arqueo.texto }}</p>
          </div>

          <p class="seccion-titulo">Novedades y cierre</p>
          <div class="zona-captura">
            <textarea
              v-model="notas"
              class="form-textarea notas"
              rows="2"
              maxlength="1000"
              placeholder="Anota cualquier novedad de la ruta (opcional)"
            />
          </div>
        </template>
        <p v-else class="vacio">Esta entrega no llevó pedidos: al cerrarla se liquida en cero.</p>

        <!-- Pegada abajo: el degradado la despega de lo que se desplaza debajo. -->
        <div class="barra-cierre">
          <button
            type="button"
            class="btn-primary"
            :disabled="!puedeCerrar"
            @click="confirmando = true"
          >
            ✓ Finalizar liquidación
          </button>
        </div>
      </template>
    </template>

    <!-- La confirmación, en una frase: cuántos, cuánto, el descuadre y qué regresa. -->
    <div v-if="confirmando" class="modal-overlay" @click.self="confirmando = false">
      <div class="modal-sheet" role="dialog" aria-label="Confirmar la liquidación">
        <div class="modal-handle" />
        <p class="modal-title">¿Finalizar la liquidación?</p>
        <p class="modal-texto">{{ fraseDeCierre }}</p>
        <div class="modal-actions">
          <button
            type="button"
            class="btn-cancel"
            :disabled="enviando"
            @click="confirmando = false"
          >
            Volver
          </button>
          <button type="button" class="btn-primary" :disabled="enviando" @click="finalizar">
            {{ enviando ? 'Cerrando…' : 'Sí, finalizar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.elegir {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  margin-bottom: 4px;
}

.elegir .pill {
  flex: none;
  padding: 7px 12px;
}

.de-entrega {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 14px;
  color: var(--ink);
}

.tabla.lista {
  min-width: 520px;
}

.lista .pedido {
  white-space: nowrap;
}

/* Un nombre largo se recorta en vez de empujar el monto fuera. */
.lista .cliente {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Los productos en un solo renglón: el que ocupa dos es uno menos por pantalla. */
.lista .productos {
  width: 99%;
  color: var(--muted);
}

.devoluciones tbody td:first-child {
  box-shadow: inset 3px 0 0 var(--rojo);
}

.chip {
  font-family: var(--font-heading);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--muted);
  white-space: nowrap;
}

.chip.rojo {
  color: var(--rojo);
}

.vacio {
  margin: 0;
  padding: 8px 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--muted);
}

/* Donde se escribe: bloque crema y campo blanco, para que se vea dónde capturar. */
.zona-captura {
  background: var(--cream-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 10px 12px;
}

.linea {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: var(--ink);
  margin-bottom: 8px;
}

/* 16px reales: con menos, Safari en iPhone amplía la página al enfocar el campo. */
.monto {
  width: 9rem;
  flex: none;
  text-align: right;
  font-size: 16px;
  font-weight: 700;
  background: var(--white);
}

.diferencia {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
}

.diferencia.ok {
  color: var(--verde-dark);
  font-weight: 600;
}

.diferencia.alerta {
  color: var(--orange-dark);
  font-weight: 600;
}

.notas {
  display: block;
  font-size: 16px;
  resize: vertical;
  min-height: 2.6rem;
  margin: 0;
  background: var(--white);
}

.barra-cierre {
  position: sticky;
  bottom: 0;
  margin-top: 14px;
  padding: 12px 0 0;
  background: linear-gradient(to top, var(--cream) 65%, transparent);
}

.barra-cierre .btn-primary {
  width: 100%;
}

.modal-texto {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--ink);
  line-height: 1.5;
}

.empty-block {
  margin: 0;
  padding: 12px 0;
}
</style>
