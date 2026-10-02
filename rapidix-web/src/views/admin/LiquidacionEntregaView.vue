<script setup lang="ts">
/**
 * Rutas → Liquidación de una entrega: su corte, al volver a bodega.
 *
 * Tiene su propia vista y no va bajo la lista de Liquidación: es un scroll
 * largo que acaba en «Finalizar liquidación», y con la lista encima había que
 * bajar a buscar dónde empezaba el corte que se acababa de elegir.
 *
 * Primero lo que el sistema dice que trae —para que cuente contra un número y
 * no contra su memoria—, luego la mercancía que baja y al final lo que él
 * declara.
 *
 * **Que el dinero no cuadre no bloquea.** Solo el campo vacío apaga el botón:
 * bloquear al repartidor no repone el dinero, y la diferencia queda escrita
 * para Finanzas.
 *
 * **Cerrar ya no descarga el camión.** La mercancía vuelve al inventario —y
 * los pedidos sin entregar a «Listo para entrega»— cuando Finanzas acepta la
 * devolución. Si la rechaza, la liquidación se deshace y la entrega vuelve
 * aquí con el motivo arriba, que es lo que hay que corregir.
 *
 * **La mercancía sí bloquea.** Lo que se cuenta al bajar es lo que vuelve al
 * inventario, así que no se finaliza hasta que cada producto que regresa
 * tiene su «Devuelto» capturado y no queda faltante. Si trae menos de lo que
 * el sistema dice, «Generar pedido x faltante» lo vuelve una venta entregada
 * en esta misma entrega: su importe se suma al efectivo a liquidar y la
 * devolución baja a lo contado, con lo que el conteo ya cuadra.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fechaDia } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import DetallePedidoRuta from './rutas/DetallePedidoRuta.vue'
import TablaConteo from './rutas/TablaConteo.vue'
import { nombreEntrega } from './rutas/etiquetas'
import {
  centavos,
  cobroDelPedido,
  conteoCompleto,
  diferenciasDelConteo,
  lineaDelArqueo,
  lineaDeProductos,
  montoCapturado,
  piezasCapturadas,
} from './rutas/liquidacion'
import type { DetalleEntregaRuta, EntregaRuta, PedidoEnRuta, ResumenCorte } from '@/api/tipos'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()

/** De vuelta a la pestaña de la que se viene, no a Entregas. */
const VOLVER = { path: '/admin/rutas', query: { ventana: 'liquidacion' } }

/**
 * La entrega, para el encabezado. Sale de su detalle, igual que los pedidos
 * completos; si no llega se liquida igual, sin nombre ni flechas.
 */
const entrega = ref<EntregaRuta | null>(null)
const resumen = ref<ResumenCorte | null>(null)
const cargando = ref(true)
const error = ref('')

/** Texto y no número: el campo vacío es distinto de cero, y vacío es lo único que bloquea. */
const declarado = ref('')
const notas = ref('')
const confirmando = ref(false)
const enviando = ref(false)

/**
 * El pedido completo, para el detalle que abre la flecha. El corte solo trae
 * lo que cuenta dinero; esto sale del detalle de la entrega y, si no llega, la
 * flecha no aparece: no es motivo para no poder liquidar.
 */
const completos = ref(new Map<string, PedidoEnRuta>())
const abierto = ref<string | null>(null)

/** Lo que el repartidor cuenta al bajar, por producto. Texto: vacío es «sin contar». */
const contados = ref<Record<string, string>>({})
const confirmandoFaltante = ref(false)
const generando = ref(false)

/** Lo contado de menos. La tabla no deja capturar de más, así que no hay sobrante. */
const faltantes = computed(() =>
  diferenciasDelConteo(resumen.value?.conteo ?? [], contados.value).filter((d) => d.faltan > 0),
)

/** `2 Pz de Queso Fresco, 1 gr de Tasajo`: lo que se va a cobrar, dicho antes de cobrarlo. */
const fraseDelFaltante = computed(() =>
  faltantes.value.map((f) => `${f.faltan} ${f.unidad} de ${f.nombre}`).join(', '),
)

/** Las dos listas salen del mismo arreglo partido en dos: cada pedido está en una sola. */
const entregados = computed(() => resumen.value?.pedidos.filter((p) => !p.devolucion) ?? [])
const devueltos = computed(() => resumen.value?.pedidos.filter((p) => p.devolucion) ?? [])
const sinPedidos = computed(() => (resumen.value?.pedidos.length ?? 0) === 0)

const capturado = computed(() => montoCapturado(declarado.value))
const arqueo = computed(() => lineaDelArqueo(resumen.value?.montoCalculado ?? 0, capturado.value))

/** Cada producto que regresa está contado y sin faltante. Sin nada que regrese, también. */
const conteoListo = computed(() => conteoCompleto(resumen.value?.conteo ?? [], contados.value))

/** Lo que regresa y todavía no tiene su «Devuelto». */
const sinContar = computed(() =>
  (resumen.value?.conteo ?? []).filter(
    (p) => p.devolucion > 0 && piezasCapturadas(contados.value[p.productoId]) === null,
  ),
)

/**
 * Por qué no se puede finalizar todavía, junto al botón apagado. El faltante
 * va primero: es lo que tiene un paso que dar; lo demás es terminar de contar.
 */
const avisoDelConteo = computed(() => {
  if (conteoListo.value) return ''
  if (faltantes.value.length > 0)
    return `Faltan ${fraseDelFaltante.value}: genera el pedido por faltante para poder finalizar.`
  if (sinContar.value.length > 0)
    return `Falta contar lo que bajas de ${sinContar.value.map((p) => p.nombre).join(', ')}.`
  return ''
})

/** Sin pedidos no hay arqueo que capturar: se cierra en cero. */
const puedeCerrar = computed(
  () =>
    resumen.value !== null &&
    !enviando.value &&
    conteoListo.value &&
    (sinPedidos.value || capturado.value !== null),
)

const titulo = computed(() =>
  entrega.value ? `Liquidación de ${nombreEntrega(entrega.value)}` : 'Liquidación',
)

let peticion = 0

async function cargar(): Promise<void> {
  const numero = ++peticion
  const id = String(route.params.id)
  entrega.value = null
  resumen.value = null
  declarado.value = ''
  notas.value = ''
  contados.value = {}
  abierto.value = null
  error.value = ''
  cargando.value = true
  try {
    const [respuesta] = await Promise.all([
      http.get<ResumenCorte>(`/admin/rutas/entregas/${id}/corte`),
      cargarEntrega(id, numero),
    ])
    if (numero === peticion) resumen.value = respuesta
  } catch (fallo) {
    if (numero === peticion)
      error.value =
        fallo instanceof ErrorApi
          ? fallo.message
          : 'No pudimos calcular tu corte. Inténtalo otra vez.'
  } finally {
    if (numero === peticion) cargando.value = false
  }
}

async function cargarEntrega(id: string, numero: number): Promise<void> {
  try {
    const detalle = await http.get<DetalleEntregaRuta>(`/admin/rutas/entregas/${id}`)
    if (numero !== peticion) return
    entrega.value = detalle.entrega
    completos.value = new Map(detalle.pedidos.map((p) => [p.id, p]))
  } catch {
    if (numero === peticion) completos.value = new Map()
  }
}

onMounted(cargar)
// De una liquidación a otra sin salir de la vista.
watch(
  () => route.params.id,
  () => void cargar(),
)

function alternar(id: string): void {
  abierto.value = abierto.value === id ? null : id
}

/**
 * El faltante se vuelve pedido. La API pone el precio y devuelve el corte ya
 * con él: el efectivo a liquidar sube y la devolución baja a lo que se contó.
 */
async function generarFaltante(): Promise<void> {
  if (faltantes.value.length === 0) return
  const id = String(route.params.id)
  const numero = peticion
  generando.value = true
  try {
    const respuesta = await http.post<ResumenCorte>(`/admin/rutas/entregas/${id}/faltante`, {
      lineas: faltantes.value.map((f) => ({ productoId: f.productoId, cantidad: f.faltan })),
    })
    confirmandoFaltante.value = false
    if (numero !== peticion) return
    resumen.value = respuesta
    ui.exito('Pedido por faltante generado: ya se suma a tu efectivo a liquidar.')
    await cargarEntrega(id, numero)
  } catch (fallo) {
    confirmandoFaltante.value = false
    ui.errorDeApi(fallo)
  } finally {
    generando.value = false
  }
}

/** El aviso del diálogo, en una sola frase: es lo que cambia lo que hace mañana. */
const fraseDeCierre = computed(() => {
  const r = resumen.value
  if (!r) return ''
  const monto = sinPedidos.value ? 0 : (capturado.value ?? 0)
  const cual = entrega.value ? nombreEntrega(entrega.value) : 'esta entrega'
  const partes = [
    `Vas a liquidar ${r.pedidos.length} pedido(s) de ${cual}`,
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
      ? 'esto finaliza la entrega; es la última abierta, así que tu jornada se cierra cuando Finanzas acepte la devolución'
      : 'esto finaliza la entrega; Finanzas tiene que aceptar la devolución y el dinero',
  )
  return partes.join('; ') + '.'
})

async function finalizar(): Promise<void> {
  if (!puedeCerrar.value) return
  enviando.value = true
  try {
    await http.post(`/admin/rutas/entregas/${String(route.params.id)}/corte`, {
      montoDeclarado: sinPedidos.value ? 0 : capturado.value,
      // Lo contado al bajar: la API comprueba que es lo que regresa antes de cerrar.
      devueltos: (resumen.value?.conteo ?? []).flatMap((p) => {
        const cantidad = piezasCapturadas(contados.value[p.productoId])
        return cantidad === null ? [] : [{ productoId: p.productoId, cantidad }]
      }),
      // Se lee al pulsar: la nota se escribe justo antes de cerrar.
      ...(notas.value.trim() ? { notas: notas.value.trim() } : {}),
    })
    confirmando.value = false
    ui.exito('Liquidación finalizada. Síguela en Historial mientras Finanzas la acepta.')
    // Ya liquidada no hay nada que hacer aquí: de vuelta a las que faltan.
    await router.replace(VOLVER)
  } catch (fallo) {
    confirmando.value = false
    ui.errorDeApi(fallo)
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <div class="pantalla pantalla-rutas sin-colchon">
    <RouterLink :to="VOLVER" class="admin-back-inline">← Liquidación</RouterLink>

    <SkeletonList v-if="cargando" :cantidad="3" />

    <p v-else-if="error" class="error-bloque">
      {{ error }}
      <button type="button" class="enlace" @click="cargar">Reintentar</button>
    </p>

    <template v-else-if="resumen">
      <header class="cabeza">
        <div class="datos">
          <p class="titulo">{{ titulo }}</p>
          <p v-if="entrega" class="cuenta">
            {{ entrega.folio }} · {{ fechaDia(entrega.creadoEn) }} · {{ entrega.pedidos }} pedido(s)
            · {{ entrega.entregados }} entregado(s)
          </p>
        </div>
        <!-- Por si falta algo antes de cortar: reanudarla se hace dentro de ella. -->
        <RouterLink
          v-if="entrega"
          :to="`/admin/rutas/entregas/${entrega.id}`"
          class="btn-secondary ver"
        >
          Ver entrega
        </RouterLink>
      </header>

      <!-- Finanzas rechazó la devolución: qué no cuadró, antes de volver a contar. -->
      <div v-if="resumen.rechazoDevolucion" class="rechazo" role="alert">
        <p class="rechazo-titulo">Finanzas rechazó la devolución de esta entrega</p>
        <p class="rechazo-motivo">{{ resumen.rechazoDevolucion }}</p>
        <p class="rechazo-ayuda">
          La liquidación se deshizo. Revisa lo que bajas del camión y vuelve a finalizarla; si falta
          entregar algo, reanuda la entrega desde «Ver entrega».
        </p>
      </div>

      <!-- El dinero que trae, pedido por pedido. -->
      <p class="seccion-titulo">Efectivo a liquidar ({{ entregados.length }})</p>
      <div v-if="entregados.length > 0" class="tabla-envoltorio">
        <table class="tabla lista una-fija">
          <thead>
            <tr>
              <th>Pedido</th>
              <th class="num">Efectivo</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="pedido in entregados" :key="pedido.id">
              <tr :class="{ 'con-detalle': abierto === pedido.id }">
                <td class="pedido">
                  <div class="con-flecha">
                    <!-- La flecha va primero, como en Operaciones: abre el detalle. -->
                    <button
                      v-if="completos.has(pedido.id)"
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
                    <div>
                      <span class="folio">📦 {{ pedido.folio }}</span>
                      <span class="sub cliente">
                        {{ pedido.clienteNombre }}{{ pedido.porFaltante ? ' · Faltante' : '' }}
                      </span>
                    </div>
                  </div>
                </td>
                <!-- Sin columna de productos: el detalle de la flecha ya los desglosa. -->
                <td class="num">
                  <span v-if="cobroDelPedido(pedido) === 'en-linea'" class="chip">
                    Pagado en línea
                  </span>
                  <span v-else-if="cobroDelPedido(pedido) === 'credito'" class="chip">
                    Crédito
                  </span>
                  <span v-else class="importe">{{ dinero(pedido.efectivo) }}</span>
                </td>
              </tr>
              <tr v-if="abierto === pedido.id && completos.has(pedido.id)" class="fila-detalle">
                <td colspan="2"><DetallePedidoRuta :pedido="completos.get(pedido.id)!" /></td>
              </tr>
            </template>
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
          <table class="tabla lista devoluciones una-fija">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Productos que regresan</th>
                <th class="num"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="pedido in devueltos" :key="pedido.id">
                <tr :class="{ 'con-detalle': abierto === pedido.id }">
                  <td class="pedido">
                    <div class="con-flecha">
                      <button
                        v-if="completos.has(pedido.id)"
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
                      <div>
                        <span class="folio">📦 {{ pedido.folio }}</span>
                        <span class="sub cliente">{{ pedido.clienteNombre }}</span>
                      </div>
                    </div>
                  </td>
                  <td class="productos">{{ lineaDeProductos(pedido) || '—' }}</td>
                  <td class="num">
                    <span class="chip rojo">
                      {{ pedido.estadoPago === 'CANCELADO' ? 'Cancelado' : 'Devolución' }}
                    </span>
                  </td>
                </tr>
                <tr v-if="abierto === pedido.id && completos.has(pedido.id)" class="fila-detalle">
                  <td colspan="3"><DetallePedidoRuta :pedido="completos.get(pedido.id)!" /></td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </template>

      <!-- El conteo físico de lo que baja del camión. -->
      <template v-if="resumen.conteo.length > 0">
        <p class="seccion-titulo">Producto en ruta / a devolver</p>
        <TablaConteo v-model:contados="contados" :conteo="resumen.conteo" />
        <p class="ayuda-conteo">
          En «Devuelto» captura lo que de verdad bajas del camión, hasta lo que dice «Devolución».
          Lo que no bajó queda en «Faltante». Para finalizar hay que contar todos los productos y no
          dejar faltante.
        </p>
        <!-- Solo con faltante: «Devuelto» no deja capturar de más, así que no hay sobrante. -->
        <div v-if="faltantes.length > 0" class="descuadre" aria-live="polite">
          <p>Faltan {{ fraseDelFaltante }}.</p>
          <button
            type="button"
            class="btn-primary"
            :disabled="generando"
            @click="confirmandoFaltante = true"
          >
            Generar pedido x faltante
          </button>
        </div>
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
        <p v-if="avisoDelConteo" class="aviso-cierre" aria-live="polite">{{ avisoDelConteo }}</p>
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

    <!-- El faltante se cobra: se dice qué entra al pedido antes de crearlo. -->
    <div v-if="confirmandoFaltante" class="modal-overlay" @click.self="confirmandoFaltante = false">
      <div class="modal-sheet" role="dialog" aria-label="Generar pedido por faltante">
        <div class="modal-handle" />
        <p class="modal-title">¿Generar pedido x faltante?</p>
        <p class="modal-texto">
          Se crea un pedido en efectivo por {{ fraseDelFaltante }}, al precio de lista que
          corresponde a la cantidad. Queda entregado en esta entrega y su importe se suma a tu
          efectivo a liquidar.
        </p>
        <div class="modal-actions">
          <button
            type="button"
            class="btn-cancel"
            :disabled="generando"
            @click="confirmandoFaltante = false"
          >
            Volver
          </button>
          <button type="button" class="btn-primary" :disabled="generando" @click="generarFaltante">
            {{ generando ? 'Generando…' : 'Sí, generar' }}
          </button>
        </div>
      </div>
    </div>

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

/* La misma tarjeta que encabeza la entrega: se sabe de cuál es el corte. */
.cabeza {
  display: flex;
  align-items: center;
  gap: 10px 16px;
  background: var(--white);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
  border-left: 4px solid var(--verde);
  padding: 12px 14px;
}

.cabeza .datos {
  flex: 1;
  min-width: 0;
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

.cabeza .ver {
  flex: none;
  padding: 7px 12px;
  font-size: 12px;
  text-decoration: none;
  box-shadow: none;
}

/* El rechazo, en rojo y arriba: es lo primero que tiene que leer. */
.rechazo {
  margin-top: 10px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--rojo) 7%, var(--white));
  border: 1px solid color-mix(in srgb, var(--rojo) 35%, var(--white));
  border-left: 4px solid var(--rojo);
  border-radius: var(--radius-md);
}

.rechazo p {
  margin: 0;
}

.rechazo-titulo {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 12.5px;
  color: var(--rojo);
}

.rechazo-motivo {
  padding: 4px 0;
  font-size: 13px;
  color: var(--ink);
  white-space: pre-wrap;
}

.rechazo-ayuda {
  font-size: 12px;
  color: var(--muted);
}

.tabla.lista {
  min-width: 520px;
}

.lista .pedido {
  white-space: nowrap;
}

/* La flecha a la izquierda del folio y el cliente, centrada con los dos. */
.con-flecha {
  display: flex;
  align-items: center;
}

.con-flecha .chevron {
  flex: none;
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

/* Con la raya de la columna fija, que si no se perdería. */
.devoluciones > tbody > tr:not(.fila-detalle) > td:first-child {
  box-shadow:
    inset 3px 0 0 var(--rojo),
    inset -1px 0 0 var(--line);
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

.ayuda-conteo {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--muted);
}

/* El descuadre, en el mismo bloque crema que las zonas de captura. */
.descuadre {
  margin-top: 8px;
  padding: 10px 12px;
  background: var(--cream-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--orange-dark);
}

.descuadre p {
  margin: 0 0 6px;
}

.descuadre .btn-primary {
  width: 100%;
  margin-top: 4px;
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

/* Por qué está apagado el botón, justo encima de él. */
.aviso-cierre {
  margin: 0 0 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--orange-dark);
}

.modal-texto {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--ink);
  line-height: 1.5;
}
</style>
