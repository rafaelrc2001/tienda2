<script setup lang="ts">
/**
 * PDV → Corte de caja: el cierre del turno.
 *
 * Arriba, el turno abierto con lo que suman sus pedidos —los que se entregaron
 * y se cobraron en el mostrador— y el campo donde el cajero escribe el
 * efectivo que contó. Abajo, los turnos ya cortados con su diferencia.
 *
 * Los totales los da la API. Un pedido a domicilio capturado en el turno no
 * suma a esta caja: lo cobra el repartidor y entra a su corte de ruta.
 */
import { computed, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fechaHora } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import type { TurnoPdv } from '@/api/tipos'

const ui = useUiStore()

const turnos = ref<TurnoPdv[]>([])
const cargando = ref(true)
const error = ref('')

const declarado = ref('')
const notas = ref('')
const errorCorte = ref('')
const cortando = ref(false)

/** El abierto de quien mira. El administrador ve también los de otros cajeros, en la tabla. */
const abierto = ref<TurnoPdv | null>(null)
const cerrados = computed(() => turnos.value.filter((t) => t.id !== abierto.value?.id))

onMounted(cargar)

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    const [mio, todos] = await Promise.all([
      http.get<TurnoPdv | null>('/admin/pdv/turnos/abierto'),
      http.get<TurnoPdv[]>('/admin/pdv/turnos'),
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
  if (declarado.value === '' || Number(declarado.value) < 0) {
    errorCorte.value = 'Escribe el efectivo que contaste en caja.'
    return
  }
  if (
    !confirm(
      `¿Hacer el corte de caja del turno ${abierto.value.folio}? Ya no se le podrán agregar pedidos.`,
    )
  ) {
    return
  }
  cortando.value = true
  try {
    await http.post(`/admin/pdv/turnos/${abierto.value.id}/corte`, {
      efectivoDeclarado: Number(declarado.value),
      ...(notas.value.trim() && { notas: notas.value.trim() }),
    })
    ui.exito(`Corte de caja del turno ${abierto.value.folio} hecho`)
    declarado.value = ''
    notas.value = ''
    await cargar()
  } catch (fallo) {
    errorCorte.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos hacer el corte.'
  } finally {
    cortando.value = false
  }
}

function diferencia(turno: TurnoPdv): string {
  if (turno.diferencia === null) return '—'
  if (turno.diferencia === 0) return 'Cuadra'
  return turno.diferencia > 0
    ? `Sobran ${dinero(turno.diferencia)}`
    : `Faltan ${dinero(-turno.diferencia)}`
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
                <td>A domicilio (los cobra Rutas)</td>
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
          <label class="form-label" for="corte-notas">Notas (opcional)</label>
          <input id="corte-notas" v-model="notas" class="form-input" maxlength="300" />
        </div>

        <p v-if="abierto.totales.porEntregar > 0" class="form-error">
          Hay {{ abierto.totales.porEntregar }} pedido(s) sin entregar: entrégalos en Punto de Venta
          antes del corte.
        </p>
        <p v-if="errorCorte" class="form-error">{{ errorCorte }}</p>

        <button
          type="button"
          class="btn-primary ancho"
          :disabled="cortando || abierto.totales.porEntregar > 0"
          @click="hacerCorte"
        >
          {{ cortando ? 'Cerrando…' : 'Hacer corte de caja' }}
        </button>
      </template>
      <p v-else class="empty-block">
        No tienes un turno abierto. Créalo en la pestaña Punto de Venta.
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
              <th>Estatus</th>
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
              <td>
                <span class="mini-tag">{{ t.cerradoEn ? 'Cerrado' : 'Abierto' }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty-block">Todavía no hay cortes de caja.</p>
    </template>
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

.tabla-turnos {
  min-width: 760px;
}

.sub {
  display: block;
  font-size: 10.5px;
  color: var(--muted);
  margin-top: 2px;
}
</style>
