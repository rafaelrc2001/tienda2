<script setup lang="ts">
/**
 * Finanzas → Cortes de ruta → un corte: aceptar lo que el repartidor trae de
 * su entrega.
 *
 * Tiene su propia vista, como la entrega y la liquidación en Rutas: con el
 * detalle desplegado bajo la fila la tabla se hacía larguísima y en el
 * teléfono había que desplazarla de lado para llegar a los botones.
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
import { useRoute, useRouter } from 'vue-router'
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
  nombreEstadoCorte,
  nombreResultado,
} from './rutas/liquidacion'
import type { Corte, DetalleCorte, FiltroCortes } from '@/api/tipos'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()

const FILTROS: FiltroCortes[] = ['por-aceptar', 'con-adeudo', 'cerrados']

/** De vuelta a la pestaña de la que se viene, no siempre a «Por aceptar». */
const volver = computed(() => {
  const filtro = route.query.filtro
  return FILTROS.includes(filtro as FiltroCortes) && filtro !== 'por-aceptar'
    ? { path: '/admin/finanzas/cortes', query: { filtro: filtro as string } }
    : { path: '/admin/finanzas/cortes' }
})

const id = computed(() => String(route.params.id))
const detalle = ref<DetalleCorte | null>(null)
const corte = computed(() => detalle.value?.corte ?? null)
const cargando = ref(true)
const error = ref('')
const guardando = ref(false)

async function cargar(conEsqueleto = true): Promise<void> {
  if (conEsqueleto) cargando.value = true
  error.value = ''
  try {
    detalle.value = await http.get<DetalleCorte>(`/admin/finanzas/cortes/${id.value}`)
  } catch (fallo) {
    error.value =
      fallo instanceof ErrorApi ? fallo.message : 'No pudimos cargar lo que salió en la entrega.'
  } finally {
    cargando.value = false
  }
}

onMounted(() => cargar())

/** Si regresa mercancía: sin nada que bajar, la devolución se acepta igual, pero se dice. */
const regresaAlgo = computed(() => detalle.value?.conteo.some((p) => p.devolucion > 0) ?? false)

// ------------------------------------------------------------------
// Aceptar y rechazar
// ------------------------------------------------------------------

type Paso = 'devolucion' | 'dinero' | 'entrega'

/** La hoja de confirmación abierta: ninguno de los tres pasos se deshace. */
const confirmando = ref<Paso | null>(null)
const rechazando = ref(false)
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
  const paso = confirmando.value
  const c = corte.value
  if (!paso || !c) return ''
  if (paso === 'devolucion') {
    return 'La mercancía que regresó vuelve al inventario. Revisa que lo que bajó del camión sea lo de la tabla: después ya no se puede rechazar.'
  }
  if (paso === 'dinero') {
    return `Recibes ${dinero(c.dineroPorAceptar ?? 0)} de ${c.repartidorNombre}. Queda anotado en Ingresos y ya no se puede corregir.`
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
  const paso = confirmando.value
  const antes = corte.value
  if (!paso || !antes) return

  guardando.value = true
  try {
    const actualizado = await http.post<Corte>(`/admin/finanzas/cortes/${antes.id}/${RUTA[paso]}`)
    if (detalle.value) detalle.value = { ...detalle.value, corte: actualizado }
    ui.exito(avisoDe(paso, antes, actualizado))
  } catch (fallo) {
    // Un 409 aquí suele ser que otra persona lo aceptó entre medias.
    ui.errorDeApi(fallo)
  } finally {
    guardando.value = false
    confirmando.value = null
  }
  // «Entrega aceptada» cambia el pago de sus pedidos; un 409, el corte entero.
  await cargar(false)
}

function abrirRechazo(): void {
  motivo.value = ''
  errorMotivo.value = ''
  rechazando.value = true
}

async function rechazar(): Promise<void> {
  const c = corte.value
  if (!c) return
  if (!motivo.value.trim()) {
    errorMotivo.value = 'Escribe qué no cuadró: es lo que el repartidor va a leer.'
    return
  }

  guardando.value = true
  try {
    await http.post<void>(`/admin/finanzas/cortes/${c.id}/rechazar-devolucion`, {
      motivo: motivo.value.trim(),
    })
    ui.exito(`Devolución rechazada: ${c.repartidorNombre} tiene que volver a liquidar.`)
    rechazando.value = false
    // El corte se borró: aquí ya no queda nada que ver.
    void router.replace(volver.value)
  } catch (fallo) {
    if (fallo instanceof ErrorApi && fallo.estado === 400) {
      errorMotivo.value = fallo.porCampo(['motivo']).campos.motivo ?? fallo.message
      return
    }
    ui.errorDeApi(fallo)
    rechazando.value = false
    await cargar(false)
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <div class="pantalla pantalla-rutas sin-colchon">
    <RouterLink :to="volver" class="admin-back-inline">← Cortes de ruta</RouterLink>

    <SkeletonList v-if="cargando" :cantidad="3" />

    <p v-else-if="error" class="error-bloque">
      {{ error }}
      <button type="button" class="enlace" @click="cargar()">Reintentar</button>
    </p>

    <template v-else-if="corte && detalle">
      <header class="cabeza">
        <div class="datos">
          <p class="titulo">{{ corte.entrega?.folio ?? 'Corte sin folio' }}</p>
          <p class="cuenta">
            🛵 {{ corte.repartidorNombre }}
            <template v-if="corte.entrega"> · {{ nombreEntrega(corte.entrega) }}</template>
          </p>
          <p class="cuenta">
            Liquidado {{ fechaHora(corte.cerradoEn) }} · {{ corte.pedidos }} pedido(s)
          </p>
        </div>
        <span class="mini-tag" :class="{ cerrado: corte.estado === 'CERRADO' }">
          {{ nombreEstadoCorte(corte.estado) }}
        </span>
      </header>

      <div class="tarjeta">
        <!-- 1. La mercancía que regresa. -->
        <section class="paso">
          <h3 class="paso-titulo">Entrega de devolución</h3>
          <table v-if="detalle.conteo.length > 0" class="tabla-lineas">
            <thead>
              <tr>
                <th>Producto</th>
                <th class="num">Recolectado</th>
                <th class="num">Entregado</th>
                <th class="num">Devolución</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in detalle.conteo" :key="p.productoId">
                <td>
                  {{ p.nombre }} <span class="unidad">{{ p.unidad }}</span>
                </td>
                <td class="num">{{ p.cargado }}</td>
                <td class="num">{{ p.entregado }}</td>
                <td class="num fuerte">{{ p.devolucion }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!regresaAlgo" class="nota">No regresa mercancía en esta entrega.</p>

          <p v-if="corte.devolucionAceptadaEn" class="hecho">
            ✓ Aceptada por {{ corte.devolucionAceptadaPorNombre ?? '—' }} ·
            {{ fechaHora(corte.devolucionAceptadaEn) }}
          </p>
          <div v-else class="botones">
            <button
              type="button"
              class="btn-primary"
              :disabled="guardando"
              @click="confirmando = 'devolucion'"
            >
              Aceptar devolución
            </button>
            <button type="button" class="btn-secondary" :disabled="guardando" @click="abrirRechazo">
              Rechazar
            </button>
          </div>
        </section>

        <!-- 2. El dinero: lo declarado primero y, si quedó adeudo, sus abonos. -->
        <section class="paso">
          <h3 class="paso-titulo">Entrega de efectivo</h3>
          <table class="tabla-lineas">
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

          <div v-if="corte.abonos.length > 0" class="desplaza">
            <table class="tabla-lineas">
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
          </div>

          <div v-if="!corte.recibidoEn || abonoPendiente(corte)" class="botones">
            <button
              type="button"
              class="btn-primary"
              :disabled="guardando || !corte.devolucionAceptadaEn"
              @click="confirmando = 'dinero'"
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
              @click="confirmando = 'entrega'"
            >
              Entrega aceptada
            </button>
            <span v-if="esperaDelCorte(corte) !== 'entrega'" class="espera">
              Primero acepta la devolución y el dinero.
            </span>
          </div>
        </section>

        <p v-if="corte.notas" class="notas">📝 {{ corte.notas }}</p>
      </div>

      <!-- Lo que salió en la entrega, para saber de dónde viene cada cifra. -->
      <template v-if="detalle.pedidos.length > 0">
        <p class="seccion-titulo">Pedidos de la entrega ({{ detalle.pedidos.length }})</p>
        <div class="tarjeta desplaza">
          <table class="tabla-lineas pedidos">
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
              <tr v-for="pedido in detalle.pedidos" :key="pedido.id">
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
        </div>
      </template>
    </template>

    <!-- Ninguno de los tres pasos se deshace: se confirma antes. -->
    <div v-if="confirmando && corte" class="modal-overlay" @click.self="confirmando = null">
      <div class="modal-sheet" role="dialog" :aria-label="TITULO[confirmando]">
        <div class="modal-handle" />
        <p class="modal-title">{{ TITULO[confirmando] }} · {{ corte.entrega?.folio ?? 'corte' }}</p>
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
            {{ guardando ? 'Guardando…' : TITULO[confirmando] }}
          </button>
        </div>
      </div>
    </div>

    <!-- Rechazar la devolución deshace la liquidación entera. -->
    <div v-if="rechazando && corte" class="modal-overlay" @click.self="rechazando = false">
      <div class="modal-sheet" role="dialog" aria-label="Rechazar la devolución">
        <div class="modal-handle" />
        <p class="modal-title">Rechazar la devolución de {{ corte.repartidorNombre }}</p>
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
          <button
            type="button"
            class="btn-cancel"
            :disabled="guardando"
            @click="rechazando = false"
          >
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

.cabeza .mini-tag {
  flex: none;
}

.mini-tag.cerrado {
  background: color-mix(in srgb, var(--verde) 15%, var(--white));
  color: var(--verde-compra);
}

.tarjeta {
  margin-top: 10px;
  background: var(--white);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
  padding: 12px 14px;
}

/* Las tablas anchas (abonos, pedidos) se desplazan dentro de su caja en el teléfono. */
.desplaza {
  overflow-x: auto;
}

.tabla-lineas.pedidos {
  min-width: 520px;
}

.tabla-lineas td.falta,
.nota.falta {
  color: var(--rojo);
}

/* Cada paso es un bloque, separado del siguiente por una línea. */
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

.desplaza > .tabla-lineas {
  margin-top: 10px;
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
