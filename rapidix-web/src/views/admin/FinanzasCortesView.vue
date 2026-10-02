<script setup lang="ts">
/**
 * Administración → Finanzas → Cortes de ruta: aceptar lo que cada repartidor
 * trae de su entrega.
 *
 * Un corte se acepta en tres pasos y en ese orden, que es el orden en que las
 * cosas llegan al mostrador:
 *
 *  1. **Entrega de devolución**: la mercancía que regresa. Aceptarla la
 *     devuelve al inventario; rechazarla deshace la liquidación y el
 *     repartidor la vuelve a hacer.
 *  2. **Entrega de efectivo**: se acepta lo que él declaró, sin capturar otra
 *     cifra, y queda anotado en Ingresos.
 *  3. **Entrega aceptada**: cierra la revisión. Si el dinero aceptado no cubre
 *     lo que dice el sistema, el corte queda con adeudo y lo que el repartidor
 *     traiga después vuelve a pasar por «Aceptar dinero».
 *
 * Qué paso toca lo decide `esperaDelCorte()`; aquí solo se apagan los botones
 * de los que todavía no. La API vuelve a comprobar el orden (409) y que quien
 * acepta no sea quien liquidó (`RECIBE_EL_MISMO`): de esos solo se enseña el
 * mensaje.
 */
import { computed, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fechaHora, nombreEstadoPago, nombreMetodoPago } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import { nombreEntrega } from './rutas/etiquetas'
import {
  abonoPendiente,
  centavos,
  esperaDelCorte,
  faltanteDe,
  nombreResultado,
  type EsperaDelCorte,
} from './rutas/liquidacion'
import type { Corte, DetalleCorte, FiltroCortes, ListadoCortes } from '@/api/tipos'

const ui = useUiStore()

const PESTANAS: { filtro: FiltroCortes; titulo: string }[] = [
  { filtro: 'por-aceptar', titulo: 'Por aceptar' },
  { filtro: 'con-adeudo', titulo: 'Con adeudo' },
  { filtro: 'cerrados', titulo: 'Cerrados' },
]

const VACIO: Record<FiltroCortes, string> = {
  'por-aceptar': 'No hay cortes esperando que se acepten. 🎉',
  'con-adeudo': 'Ningún repartidor debe dinero de sus cortes.',
  cerrados: 'Todavía no se ha cerrado ningún corte.',
}

/** Lo que sigue en cada corte, dicho como el botón que hay que pulsar. */
const SIGUE: Record<EsperaDelCorte, string> = {
  devolucion: 'Aceptar devolución',
  dinero: 'Aceptar dinero',
  entrega: 'Entrega aceptada',
  abono: 'Aceptar dinero',
}

const filtro = ref<FiltroCortes>('por-aceptar')
const cortes = ref<Corte[]>([])
const conteos = ref<Record<FiltroCortes, number> | null>(null)
const cargando = ref(true)
const guardando = ref(false)

/** El corte abierto y lo que salió en su entrega. Se pide al abrirlo, no antes. */
const abierto = ref<string | null>(null)
const detalles = ref<Record<string, DetalleCorte>>({})
const errorDetalle = ref('')

/** Cambiar de pestaña rápido deja respuestas viejas en el aire: gana la última. */
let peticion = 0

async function cargar(conEsqueleto = true): Promise<void> {
  const numero = ++peticion
  if (conEsqueleto) cargando.value = true
  try {
    const respuesta = await http.get<ListadoCortes>('/admin/finanzas/cortes', {
      query: { filtro: filtro.value },
    })
    if (numero !== peticion) return
    cortes.value = respuesta.cortes
    conteos.value = respuesta.conteos
    // Un corte que cambió de pestaña ya no está en la lista: se cierra su detalle.
    if (abierto.value && !respuesta.cortes.some((c) => c.id === abierto.value)) {
      abierto.value = null
    }
  } catch (fallo) {
    if (numero === peticion) ui.errorDeApi(fallo)
  } finally {
    if (numero === peticion) cargando.value = false
  }
}

onMounted(() => cargar())

function elegir(nuevo: FiltroCortes): void {
  if (nuevo === filtro.value) return
  filtro.value = nuevo
  abierto.value = null
  void cargar()
}

async function cargarDetalle(id: string): Promise<void> {
  errorDetalle.value = ''
  try {
    const detalle = await http.get<DetalleCorte>(`/admin/finanzas/cortes/${id}`)
    detalles.value = { ...detalles.value, [id]: detalle }
  } catch (fallo) {
    if (abierto.value === id) {
      errorDetalle.value =
        fallo instanceof ErrorApi ? fallo.message : 'No pudimos cargar lo que salió en la entrega.'
    }
  }
}

function alternar(id: string): void {
  abierto.value = abierto.value === id ? null : id
  if (abierto.value) void cargarDetalle(id)
}

function sigue(corte: Corte): string {
  const espera = esperaDelCorte(corte)
  if (espera) return SIGUE[espera]
  return corte.estado === 'CERRADO' ? '—' : 'Espera al repartidor'
}

/** Si regresa mercancía: sin nada que bajar, la devolución se acepta igual, pero se dice. */
function regresaAlgo(detalle: DetalleCorte): boolean {
  return detalle.conteo.some((p) => p.devolucion > 0)
}

// ------------------------------------------------------------------
// Aceptar y rechazar
// ------------------------------------------------------------------

type Paso = 'devolucion' | 'dinero' | 'entrega'

/** La hoja de confirmación abierta: ninguno de los tres pasos se deshace. */
const confirmando = ref<{ corte: Corte; paso: Paso } | null>(null)
const rechazando = ref<Corte | null>(null)
const motivo = ref('')
const errorMotivo = ref('')

const RUTA: Record<Paso, string> = {
  devolucion: 'aceptar-devolucion',
  dinero: 'aceptar-dinero',
  entrega: 'aceptar-entrega',
}

const TITULO: Record<Paso, string> = {
  devolucion: 'Aceptar devolución',
  dinero: 'Aceptar dinero',
  entrega: 'Entrega aceptada',
}

const textoConfirmacion = computed(() => {
  const c = confirmando.value
  if (!c) return ''
  if (c.paso === 'devolucion') {
    return 'La mercancía que regresó vuelve al inventario. Revisa que lo que bajó del camión sea lo de la tabla: después ya no se puede rechazar.'
  }
  if (c.paso === 'dinero') {
    return `Recibes ${dinero(c.corte.dineroPorAceptar ?? 0)} de ${c.corte.repartidorNombre}. Queda anotado en Ingresos y ya no se puede corregir.`
  }
  return 'Los pedidos en efectivo quedan pagados y los de crédito pasan a CXC. Si el dinero aceptado no cubre lo que dice el sistema, el corte queda con adeudo.'
})

function avisoDe(paso: Paso, antes: Corte, despues: Corte): string {
  const cerrado = despues.estado === 'CERRADO'
  if (paso === 'devolucion') return 'Devolución aceptada: la mercancía volvió al inventario.'
  if (paso === 'dinero') {
    const cuanto = dinero(antes.dineroPorAceptar ?? 0)
    return cerrado
      ? `${cuanto} aceptados. El corte queda cerrado.`
      : `${cuanto} aceptados y anotados en Ingresos.`
  }
  return cerrado
    ? 'Entrega aceptada: el corte queda cerrado.'
    : `Entrega aceptada. ${despues.repartidorNombre} debe ${dinero(faltanteDe(despues))}.`
}

async function aceptar(): Promise<void> {
  const c = confirmando.value
  if (!c) return

  guardando.value = true
  try {
    const actualizado = await http.post<Corte>(
      `/admin/finanzas/cortes/${c.corte.id}/${RUTA[c.paso]}`,
    )
    cortes.value = cortes.value.map((otro) => (otro.id === actualizado.id ? actualizado : otro))
    ui.exito(avisoDe(c.paso, c.corte, actualizado))
  } catch (fallo) {
    // Un 409 aquí suele ser que otra persona lo aceptó entre medias.
    ui.errorDeApi(fallo)
  } finally {
    guardando.value = false
    confirmando.value = null
  }
  await refrescar(c.corte.id)
}

function abrirRechazo(corte: Corte): void {
  motivo.value = ''
  errorMotivo.value = ''
  rechazando.value = corte
}

async function rechazar(): Promise<void> {
  const corte = rechazando.value
  if (!corte) return
  if (!motivo.value.trim()) {
    errorMotivo.value = 'Escribe qué no cuadró: es lo que el repartidor va a leer.'
    return
  }

  guardando.value = true
  try {
    await http.post<void>(`/admin/finanzas/cortes/${corte.id}/rechazar-devolucion`, {
      motivo: motivo.value.trim(),
    })
    ui.exito(`Devolución rechazada: ${corte.repartidorNombre} tiene que volver a liquidar.`)
    rechazando.value = null
  } catch (fallo) {
    if (fallo instanceof ErrorApi && fallo.estado === 400) {
      errorMotivo.value = fallo.porCampo(['motivo']).campos.motivo ?? fallo.message
      return
    }
    ui.errorDeApi(fallo)
    rechazando.value = null
  } finally {
    guardando.value = false
  }
  await refrescar(corte.id)
}

/**
 * Tras cada paso se relee la lista —el corte puede haber cambiado de pestaña o
 * ya no existir— y, si sigue a la vista, su detalle: «Entrega aceptada» cambia
 * el pago de sus pedidos.
 */
async function refrescar(id: string): Promise<void> {
  await cargar(false)
  if (abierto.value === id) await cargarDetalle(id)
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin/finanzas" class="admin-back-inline">← Finanzas · Pedidos</RouterLink>

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

    <div v-else-if="cortes.length > 0" class="tabla-envoltorio">
      <table class="tabla lineal">
        <thead>
          <tr>
            <th>Reparto</th>
            <th>Repartidor</th>
            <th class="num">Pedidos</th>
            <th class="num">Dice el sistema</th>
            <th class="num">Declaró</th>
            <th class="num">Aceptado</th>
            <th class="num">Adeudo</th>
            <th>Sigue</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="corte in cortes" :key="corte.id">
            <tr :class="{ 'con-detalle': abierto === corte.id }">
              <td>
                <span class="folio">{{ corte.entrega?.folio ?? 'Sin folio' }}</span>
                <span class="sub">
                  <template v-if="corte.entrega">{{ nombreEntrega(corte.entrega) }} · </template>
                  Liquidado {{ fechaHora(corte.cerradoEn) }}
                </span>
                <div class="enlaces">
                  <button type="button" class="enlace" @click="alternar(corte.id)">
                    {{ abierto === corte.id ? 'Ocultar corte' : 'Ver corte' }}
                  </button>
                </div>
              </td>
              <td class="nombre">🛵 {{ corte.repartidorNombre }}</td>
              <td class="num">{{ corte.pedidos }}</td>
              <td class="num importe">{{ dinero(corte.montoCalculado) }}</td>
              <td class="num">{{ dinero(corte.montoDeclarado) }}</td>
              <td class="num">
                {{ corte.montoRecibido !== null ? dinero(corte.montoRecibido) : '—' }}
              </td>
              <td class="num importe" :class="{ falta: faltanteDe(corte) > 0 }">
                <template v-if="corte.recibidoEn">
                  {{ faltanteDe(corte) > 0 ? dinero(faltanteDe(corte)) : 'Sin adeudo' }}
                </template>
                <template v-else>—</template>
              </td>
              <td class="sigue">{{ sigue(corte) }}</td>
            </tr>

            <tr v-if="abierto === corte.id" class="fila-detalle">
              <td colspan="8">
                <!-- 1. La mercancía que regresa. -->
                <section class="paso">
                  <h3 class="paso-titulo">Entrega de devolución</h3>
                  <template v-if="detalles[corte.id]">
                    <table v-if="detalles[corte.id].conteo.length > 0" class="tabla-lineas angosta">
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th class="num">Recolectado</th>
                          <th class="num">Entregado</th>
                          <th class="num">Devolución</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="p in detalles[corte.id].conteo" :key="p.productoId">
                          <td>
                            {{ p.nombre }} <span class="unidad">{{ p.unidad }}</span>
                          </td>
                          <td class="num">{{ p.cargado }}</td>
                          <td class="num">{{ p.entregado }}</td>
                          <td class="num fuerte">{{ p.devolucion }}</td>
                        </tr>
                      </tbody>
                    </table>
                    <p v-if="!regresaAlgo(detalles[corte.id])" class="nota">
                      No regresa mercancía en esta entrega.
                    </p>
                  </template>
                  <p v-else-if="errorDetalle" class="nota falta">{{ errorDetalle }}</p>
                  <p v-else class="nota">Cargando lo que baja del camión…</p>

                  <p v-if="corte.devolucionAceptadaEn" class="hecho">
                    ✓ Aceptada por {{ corte.devolucionAceptadaPorNombre ?? '—' }} ·
                    {{ fechaHora(corte.devolucionAceptadaEn) }}
                  </p>
                  <div v-else class="botones">
                    <button
                      type="button"
                      class="btn-primary"
                      :disabled="guardando"
                      @click="confirmando = { corte, paso: 'devolucion' }"
                    >
                      Aceptar devolución
                    </button>
                    <button
                      type="button"
                      class="btn-secondary"
                      :disabled="guardando"
                      @click="abrirRechazo(corte)"
                    >
                      Rechazar
                    </button>
                  </div>
                </section>

                <!-- 2. El dinero: lo declarado primero y, si quedó adeudo, sus abonos. -->
                <section class="paso">
                  <h3 class="paso-titulo">Entrega de efectivo</h3>
                  <table class="tabla-lineas angosta">
                    <tbody>
                      <tr>
                        <td>Dice el sistema</td>
                        <td class="num">{{ dinero(corte.montoCalculado) }}</td>
                      </tr>
                      <tr>
                        <td>Declaró el repartidor</td>
                        <td class="num">{{ dinero(corte.montoDeclarado) }}</td>
                      </tr>
                      <tr v-if="centavos(corte.diferencia) !== 0">
                        <td>Diferencia</td>
                        <td class="num" :class="{ falta: corte.diferencia < 0 }">
                          {{ dinero(corte.diferencia) }}
                        </td>
                      </tr>
                      <tr v-if="corte.montoRecibido !== null">
                        <td>
                          Aceptado por {{ corte.recibidoPorNombre ?? '—' }} ·
                          {{ fechaHora(corte.recibidoEn) }}
                        </td>
                        <td class="num abono">{{ dinero(corte.montoRecibido) }}</td>
                      </tr>
                      <tr v-if="corte.recibidoEn" class="fuerte">
                        <td>Adeudo</td>
                        <td class="num" :class="{ falta: faltanteDe(corte) > 0 }">
                          {{ dinero(faltanteDe(corte)) }}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <table v-if="corte.abonos.length > 0" class="tabla-lineas angosta">
                    <thead>
                      <tr>
                        <th>Entregó después</th>
                        <th>Nota</th>
                        <th>Estatus</th>
                        <th class="num">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="abono in corte.abonos" :key="abono.id">
                        <td class="fecha">{{ fechaHora(abono.creadoEn) }}</td>
                        <td>{{ abono.nota ?? '—' }}</td>
                        <td>{{ abono.aceptadoEn ? 'Aceptado' : 'Por aceptar' }}</td>
                        <td class="num" :class="{ abono: abono.aceptadoEn }">
                          {{ dinero(abono.monto) }}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <div v-if="!corte.recibidoEn || abonoPendiente(corte)" class="botones">
                    <button
                      type="button"
                      class="btn-primary"
                      :disabled="guardando || !corte.devolucionAceptadaEn"
                      @click="confirmando = { corte, paso: 'dinero' }"
                    >
                      Aceptar dinero · {{ dinero(corte.dineroPorAceptar ?? 0) }}
                    </button>
                    <span v-if="!corte.devolucionAceptadaEn" class="espera">
                      Primero acepta la devolución.
                    </span>
                  </div>
                </section>

                <!-- 3. El cierre de la revisión. -->
                <section class="paso">
                  <h3 class="paso-titulo">Entrega aceptada</h3>
                  <p v-if="corte.entregaAceptadaEn" class="hecho">
                    ✓ Aceptada por {{ corte.entregaAceptadaPorNombre ?? '—' }} ·
                    {{ fechaHora(corte.entregaAceptadaEn) }}
                  </p>
                  <div v-else class="botones">
                    <button
                      type="button"
                      class="btn-primary"
                      :disabled="guardando || esperaDelCorte(corte) !== 'entrega'"
                      @click="confirmando = { corte, paso: 'entrega' }"
                    >
                      Entrega aceptada
                    </button>
                    <span v-if="esperaDelCorte(corte) !== 'entrega'" class="espera">
                      Primero acepta la devolución y el dinero.
                    </span>
                  </div>
                </section>

                <!-- Lo que salió en la entrega, para saber de dónde viene cada cifra. -->
                <section v-if="detalles[corte.id]?.pedidos.length" class="paso">
                  <h3 class="paso-titulo">Pedidos de la entrega</h3>
                  <table class="tabla-lineas">
                    <thead>
                      <tr>
                        <th>Pedido</th>
                        <th>Cliente</th>
                        <th>Resultado</th>
                        <th>Pago</th>
                        <th class="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="pedido in detalles[corte.id].pedidos" :key="pedido.id">
                        <td class="fecha">
                          {{ pedido.folio }}
                          <span v-if="pedido.porFaltante" class="unidad">por faltante</span>
                        </td>
                        <td>{{ pedido.clienteNombre }}</td>
                        <td>{{ nombreResultado(pedido.resultado) }}</td>
                        <td>
                          {{ nombreMetodoPago(pedido.metodoPago) }} ·
                          {{ nombreEstadoPago(pedido.estadoPago) }}
                        </td>
                        <td class="num">{{ dinero(pedido.total) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </section>

                <p v-if="corte.notas" class="notas">📝 {{ corte.notas }}</p>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <p v-else class="empty-block">{{ VACIO[filtro] }}</p>

    <!-- Ninguno de los tres pasos se deshace: se confirma antes. -->
    <div v-if="confirmando" class="modal-overlay" @click.self="confirmando = null">
      <div class="modal-sheet" role="dialog" :aria-label="TITULO[confirmando.paso]">
        <div class="modal-handle" />
        <p class="modal-title">
          {{ TITULO[confirmando.paso] }} · {{ confirmando.corte.entrega?.folio ?? 'corte' }}
        </p>
        <p class="modal-texto">{{ textoConfirmacion }}</p>

        <div class="modal-actions">
          <button
            type="button"
            class="btn-cancel"
            :disabled="guardando"
            @click="confirmando = null"
          >
            Volver
          </button>
          <button type="button" class="btn-primary" :disabled="guardando" @click="aceptar">
            {{ guardando ? 'Guardando…' : TITULO[confirmando.paso] }}
          </button>
        </div>
      </div>
    </div>

    <!-- Rechazar la devolución deshace la liquidación entera. -->
    <div v-if="rechazando" class="modal-overlay" @click.self="rechazando = null">
      <div class="modal-sheet" role="dialog" aria-label="Rechazar la devolución">
        <div class="modal-handle" />
        <p class="modal-title">Rechazar la devolución de {{ rechazando.repartidorNombre }}</p>
        <p class="modal-texto">
          La liquidación se deshace: el corte se borra y la entrega vuelve al repartidor para que
          cuente de nuevo y la liquide otra vez. No se mueve el inventario.
        </p>

        <label class="form-label" for="motivo-rechazo">Qué no cuadró</label>
        <textarea
          id="motivo-rechazo"
          v-model="motivo"
          class="form-textarea"
          :class="{ 'is-invalid': errorMotivo }"
          rows="3"
          maxlength="500"
          placeholder="Ej.: dice que regresan 3 quesos y bajaron 2"
        />
        <p v-if="errorMotivo" class="form-error">{{ errorMotivo }}</p>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" :disabled="guardando" @click="rechazando = null">
            Volver
          </button>
          <button type="button" class="btn-primary" :disabled="guardando" @click="rechazar">
            {{ guardando ? 'Guardando…' : 'Rechazar devolución' }}
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

.subtab-row {
  margin: 0 0 12px;
}

.tabla {
  min-width: 860px;
}

.tabla > tbody > tr > td.nombre {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 12.5px;
  white-space: nowrap;
}

.tabla > tbody > tr > td.falta,
.tabla-lineas td.falta,
.nota.falta {
  color: var(--rojo);
}

.tabla > tbody > tr > td.sigue {
  font-family: var(--font-heading);
  font-weight: 700;
  white-space: nowrap;
}

/* Cada paso es un bloque del detalle, separado del siguiente por una línea. */
.paso + .paso {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.paso-titulo {
  margin: 0 0 6px;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 12.5px;
  color: var(--ink);
}

.tabla-lineas.angosta {
  max-width: 620px;
}

.tabla-lineas .fecha {
  white-space: nowrap;
  color: var(--muted);
}

.tabla-lineas .unidad {
  color: var(--muted);
  font-size: 10.5px;
}

.tabla-lineas td.fuerte {
  font-family: var(--font-heading);
  font-weight: 800;
}

.tabla-lineas .abono {
  font-family: var(--font-heading);
  font-weight: 700;
  color: var(--verde-dark);
}

.botones {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.botones > button {
  width: auto;
  padding: 9px 16px;
  font-size: 12.5px;
}

.espera,
.nota {
  font-size: 11.5px;
  color: var(--muted);
}

.nota {
  margin: 6px 0 0;
}

.hecho {
  margin: 8px 0 0;
  font-size: 12px;
  font-family: var(--font-heading);
  font-weight: 700;
  color: var(--verde-dark);
}

.notas {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--ink);
  line-height: 1.45;
}

.modal-texto {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.45;
}
</style>
