<script setup lang="ts">
/**
 * Finanzas → Cortes → un corte de caja: aceptar el efectivo que el cajero
 * entrega de su turno del punto de venta.
 *
 * Es el hermano corto de `FinanzasCorteView`. En caja no hay mercancía que
 * regrese ni entrega que dar por aceptada, así que solo queda un paso:
 * **aceptar el dinero**. Se acepta lo que el cajero contó, sin capturar otra
 * cifra, y queda anotado en Ingresos. Si no cubre lo que dice el sistema, el
 * corte queda con adeudo, y lo que el cajero entregue después vuelve a pasar
 * por el mismo botón.
 *
 * La transferencia y la billetera se enseñan para entender el turno, pero no
 * se aceptan aquí: lo que se cuenta en la mano es el efectivo.
 *
 * La API comprueba que quien acepta no sea el cajero del turno
 * (`RECIBE_EL_MISMO`): de eso solo se enseña el mensaje.
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import {
  dinero,
  fechaHora,
  fechaNumerica,
  nombreEstadoPago,
  nombreEstadoPedido,
  nombreMetodoPago,
} from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import { centavos, nombreEstadoCorte } from './rutas/liquidacion'
import type { FiltroCortes, TurnoPdv, TurnoPdvConPedidos } from '@/api/tipos'

const route = useRoute()
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
const turno = ref<TurnoPdvConPedidos | null>(null)
const corte = computed(() => turno.value?.corte ?? null)
const cargando = ref(true)
const error = ref('')
const guardando = ref(false)
/** La hoja de confirmación: aceptar un dinero no se deshace. */
const confirmando = ref(false)

async function cargar(conEsqueleto = true): Promise<void> {
  if (conEsqueleto) cargando.value = true
  error.value = ''
  try {
    turno.value = await http.get<TurnoPdvConPedidos>(`/admin/finanzas/cortes-de-caja/${id.value}`)
  } catch (fallo) {
    error.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos cargar el corte de caja.'
  } finally {
    cargando.value = false
  }
}

onMounted(() => cargar())

/** El adeudo del cajero, ya con la tolerancia. */
const adeudo = computed(() => Math.max(0, centavos(corte.value?.saldoPendiente ?? 0)))

async function aceptar(): Promise<void> {
  const antes = turno.value
  if (!antes?.corte) return

  guardando.value = true
  try {
    const despues = await http.post<TurnoPdv>(
      `/admin/finanzas/cortes-de-caja/${antes.id}/aceptar-dinero`,
    )
    turno.value = { ...antes, ...despues }
    const cuanto = dinero(antes.corte.dineroPorAceptar ?? 0)
    const debe = Math.max(0, centavos(despues.corte?.saldoPendiente ?? 0))
    ui.exito(
      debe > 0
        ? `${cuanto} aceptados y anotados en Ingresos. ${despues.cajero} debe ${dinero(debe)}.`
        : `${cuanto} aceptados y anotados en Ingresos. El corte queda cerrado.`,
    )
  } catch (fallo) {
    // Un 409 aquí suele ser que otra persona lo aceptó entre medias.
    ui.errorDeApi(fallo)
    await cargar(false)
  } finally {
    guardando.value = false
    confirmando.value = false
  }
}
</script>

<template>
  <div class="pantalla pantalla-rutas sin-colchon">
    <RouterLink :to="volver" class="admin-back-inline">← Cortes</RouterLink>

    <SkeletonList v-if="cargando" :cantidad="3" />

    <p v-else-if="error" class="error-bloque">
      {{ error }}
      <button type="button" class="enlace" @click="cargar()">Reintentar</button>
    </p>

    <template v-else-if="turno && corte">
      <header class="cabeza">
        <div class="datos">
          <p class="titulo">{{ turno.folio }}</p>
          <p class="cuenta">
            🏪 {{ turno.cajero }} · {{ turno.tienda.nombre }} · corte
            {{ fechaHora(turno.cerradoEn) }}
          </p>
        </div>
        <span class="mini-tag" :class="{ cerrado: corte.estado === 'CERRADO' }">
          {{ nombreEstadoCorte(corte.estado) }}
        </span>
      </header>

      <div class="tarjeta">
        <!-- De dónde sale la cifra: lo que el turno cobró, por forma de pago. -->
        <section class="paso">
          <h3 class="paso-titulo">Ingresos del turno</h3>
          <table class="tabla-lineas">
            <tbody>
              <tr>
                <td>Ventas cobradas en mostrador ({{ turno.totales.cobrados }})</td>
                <td class="num">{{ dinero(turno.totales.ventas) }}</td>
              </tr>
              <tr class="fuerte">
                <td>Efectivo</td>
                <td class="num">{{ dinero(turno.totales.efectivo) }}</td>
              </tr>
              <tr>
                <td>Transferencia</td>
                <td class="num">{{ dinero(turno.totales.transferencia) }}</td>
              </tr>
              <tr>
                <td>Billetera electrónica</td>
                <td class="num">{{ dinero(turno.totales.billetera) }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- El dinero: lo contado primero y, si quedó adeudo, lo que entregó después. -->
        <section class="paso">
          <h3 class="paso-titulo">Entrega de efectivo</h3>
          <table class="tabla-lineas">
            <tbody>
              <tr>
                <td>Dice el sistema</td>
                <td class="num">{{ dinero(turno.totales.efectivo) }}</td>
              </tr>
              <tr>
                <td>Contó el cajero</td>
                <td class="num">{{ dinero(turno.efectivoDeclarado ?? 0) }}</td>
              </tr>
              <tr v-if="centavos(turno.diferencia ?? 0) !== 0">
                <td>Diferencia</td>
                <td class="num" :class="{ falta: (turno.diferencia ?? 0) < 0 }">
                  {{ dinero(turno.diferencia ?? 0) }}
                </td>
              </tr>
              <tr v-if="corte.efectivoRecibido !== null">
                <td>
                  Aceptado por {{ corte.recibidoPorNombre ?? '—' }} ·
                  {{ fechaHora(corte.recibidoEn) }}
                </td>
                <td class="num abono">{{ dinero(corte.efectivoRecibido) }}</td>
              </tr>
              <tr v-if="corte.recibidoEn" class="fuerte">
                <td>Adeudo</td>
                <td class="num" :class="{ falta: adeudo > 0 }">{{ dinero(adeudo) }}</td>
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

          <div v-if="corte.dineroPorAceptar !== null" class="botones">
            <button
              type="button"
              class="btn-primary"
              :disabled="guardando"
              @click="confirmando = true"
            >
              Aceptar dinero · {{ dinero(corte.dineroPorAceptar) }}
            </button>
          </div>
          <p v-else-if="adeudo > 0" class="nota">
            ⏳ {{ turno.cajero }} debe {{ dinero(adeudo) }}: lo entrega desde PDV → Corte de caja.
          </p>
        </section>

        <p v-if="turno.notas" class="notas">📝 {{ turno.notas }}</p>
      </div>

      <!-- Los pedidos del turno, para saber de dónde viene cada cifra. -->
      <template v-if="turno.pedidos.length > 0">
        <p class="seccion-titulo">Pedidos del turno ({{ turno.pedidos.length }})</p>
        <div class="tarjeta desplaza">
          <table class="tabla-lineas pedidos">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Pago</th>
                <th>Estatus</th>
                <th class="num">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="pedido in turno.pedidos" :key="pedido.id">
                <td class="fecha">{{ pedido.folio }}</td>
                <td class="fecha">{{ fechaNumerica(pedido.creadoEn) }}</td>
                <td>{{ pedido.clienteNombre }}</td>
                <td>
                  {{ nombreMetodoPago(pedido.pago.metodo) }} ·
                  {{ nombreEstadoPago(pedido.pago.estado) }}
                </td>
                <td>{{ nombreEstadoPedido(pedido.estado, pedido.pago.estado) }}</td>
                <td class="num">{{ dinero(pedido.total) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>

    <!-- Aceptar el dinero no se deshace: se confirma antes. -->
    <div
      v-if="confirmando && turno && corte"
      class="modal-overlay"
      @click.self="confirmando = false"
    >
      <div class="modal-sheet" role="dialog" aria-label="Aceptar dinero">
        <div class="modal-handle" />
        <p class="modal-title">Aceptar dinero · {{ turno.folio }}</p>
        <p class="modal-texto">
          Recibes {{ dinero(corte.dineroPorAceptar ?? 0) }} de {{ turno.cajero }}. Queda anotado en
          Ingresos y ya no se puede corregir.
          <template v-if="!corte.recibidoEn">
            Si no cubre lo que dice el sistema, el corte queda con adeudo.
          </template>
        </p>

        <div class="modal-actions">
          <button
            type="button"
            class="btn-cancel"
            :disabled="guardando"
            @click="confirmando = false"
          >
            Volver
          </button>
          <button type="button" class="btn-primary" :disabled="guardando" @click="aceptar">
            {{ guardando ? 'Guardando…' : 'Aceptar dinero' }}
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
  min-width: 560px;
}

.tabla-lineas td.falta {
  color: var(--rojo);
}

/* Cada bloque, separado del siguiente por una línea. */
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

.nota {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: var(--muted);
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
