<script setup lang="ts">
/**
 * Administración → Finanzas → Cortes: recibir el dinero que traen los
 * repartidores.
 *
 * Tres cifras que no son la misma y por eso se pintan juntas: lo que **dice el
 * sistema** que trae, lo que él **declaró** al cerrar y lo que aquí se
 * **cuenta**. La diferencia entre las dos primeras es suya; la que queda
 * después de contar es el saldo que se reclama, y lo que entregue más tarde
 * entra como abono en vez de reescribir los montos del día.
 *
 * Quien recibe no puede ser quien cerró: eso lo impide la API (409
 * `RECIBE_EL_MISMO`) y aquí solo se enseña su mensaje.
 */
import { onMounted, ref } from 'vue'
import { http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fechaHora } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import type { Corte, FiltroCortes, ListadoCortes } from '@/api/tipos'

const ui = useUiStore()

const PESTANAS: { filtro: FiltroCortes; titulo: string }[] = [
  { filtro: 'por-recibir', titulo: 'Por recibir' },
  { filtro: 'recibidos', titulo: 'Recibidos' },
]

const filtro = ref<FiltroCortes>('por-recibir')
const cortes = ref<Corte[]>([])
const conteos = ref<Record<FiltroCortes, number> | null>(null)
const cargando = ref(true)
const guardando = ref(false)
const abierto = ref<string | null>(null)

/** La hoja abierta: contar el dinero de un corte, o abonar sobre lo que faltó. */
const recibiendo = ref<Corte | null>(null)
const abonando = ref<Corte | null>(null)
const monto = ref<number | ''>('')
const nota = ref('')

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

function alternar(id: string): void {
  abierto.value = abierto.value === id ? null : id
}

/** Solo se ofrece abrir el detalle si hay algo que enseñar en él. */
function tieneDetalle(corte: Corte): boolean {
  return corte.abonos.length > 0 || Boolean(corte.notas)
}

function abrirRecibir(corte: Corte): void {
  // Se propone lo declarado: contar suele confirmarlo, y lo que importa es que
  // quien cuenta tenga que mirar el número antes de pulsar.
  monto.value = corte.montoDeclarado
  nota.value = ''
  recibiendo.value = corte
}

function abrirAbono(corte: Corte): void {
  monto.value = corte.saldoPendiente > 0 ? corte.saldoPendiente : ''
  nota.value = ''
  abonando.value = corte
}

async function recibir(): Promise<void> {
  const corte = recibiendo.value
  if (!corte || monto.value === '' || monto.value < 0) return

  guardando.value = true
  try {
    const actualizado = await http.post<Corte>(`/admin/finanzas/cortes/${corte.id}/recibir`, {
      montoRecibido: monto.value,
      ...(nota.value.trim() ? { notas: nota.value.trim() } : {}),
    })
    ui.exito(
      actualizado.saldoPendiente > 0
        ? `Corte recibido con ${dinero(actualizado.saldoPendiente)} pendientes.`
        : `Corte de ${actualizado.repartidorNombre} recibido completo.`,
    )
    recibiendo.value = null
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    guardando.value = false
  }
  // El corte cambia de pestaña al recibirse: se relee con sus contadores.
  await cargar(false)
}

async function abonar(): Promise<void> {
  const corte = abonando.value
  if (!corte || monto.value === '' || monto.value <= 0) return

  guardando.value = true
  try {
    const actualizado = await http.post<Corte>(`/admin/finanzas/cortes/${corte.id}/abonos`, {
      monto: monto.value,
      ...(nota.value.trim() ? { nota: nota.value.trim() } : {}),
    })
    cortes.value = cortes.value.map((c) => (c.id === actualizado.id ? actualizado : c))
    ui.exito(
      actualizado.saldoPendiente > 0
        ? `Abono registrado. Quedan ${dinero(actualizado.saldoPendiente)}.`
        : 'Abono registrado: el corte queda saldado.',
    )
    abonando.value = null
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    guardando.value = false
  }
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
      <table class="tabla">
        <thead>
          <tr>
            <th>Repartidor</th>
            <th class="num">Pedidos</th>
            <th class="num">Dice el sistema</th>
            <th class="num">Declaró</th>
            <th class="num">Diferencia</th>
            <th class="num">Contado</th>
            <th class="num">Saldo</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="corte in cortes" :key="corte.id">
            <tr :class="{ 'con-detalle': abierto === corte.id }">
              <td>
                <span class="nombre">🛵 {{ corte.repartidorNombre }}</span>
                <span class="sub">Cerrado {{ fechaHora(corte.cerradoEn) }}</span>
                <div v-if="tieneDetalle(corte)" class="enlaces">
                  <button type="button" class="enlace" @click="alternar(corte.id)">
                    {{ abierto === corte.id ? 'Ocultar detalle' : 'Ver detalle' }}
                  </button>
                </div>
              </td>
              <td class="num">{{ corte.pedidos }}</td>
              <td class="num importe">{{ dinero(corte.montoCalculado) }}</td>
              <td class="num">{{ dinero(corte.montoDeclarado) }}</td>
              <td class="num" :class="{ falta: corte.diferencia < 0 }">
                {{ dinero(corte.diferencia) }}
              </td>
              <td class="num">
                <template v-if="corte.montoRecibido !== null">
                  {{ dinero(corte.montoRecibido) }}
                  <span class="sub">{{ corte.recibidoPorNombre ?? '—' }}</span>
                </template>
                <template v-else>—</template>
              </td>
              <td class="num importe" :class="{ falta: corte.saldoPendiente > 0 }">
                <template v-if="corte.montoRecibido !== null">
                  {{ corte.saldoPendiente > 0 ? dinero(corte.saldoPendiente) : 'Saldado' }}
                </template>
                <template v-else>—</template>
              </td>
              <td class="accion">
                <button
                  v-if="corte.estado === 'CERRADO'"
                  type="button"
                  class="btn-primary"
                  @click="abrirRecibir(corte)"
                >
                  Contar y recibir
                </button>
                <button v-else type="button" class="btn-secondary" @click="abrirAbono(corte)">
                  Registrar abono
                </button>
              </td>
            </tr>

            <!-- Los abonos que llegaron después del conteo y las notas del corte. -->
            <tr v-if="abierto === corte.id" class="fila-detalle">
              <td colspan="8">
                <table v-if="corte.abonos.length > 0" class="tabla-lineas angosta">
                  <thead>
                    <tr>
                      <th>Abono</th>
                      <th>Registró</th>
                      <th>Nota</th>
                      <th class="num">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="abono in corte.abonos" :key="abono.id">
                      <td class="fecha">{{ fechaHora(abono.creadoEn) }}</td>
                      <td>{{ abono.registradoPorNombre }}</td>
                      <td>{{ abono.nota ?? '—' }}</td>
                      <td class="num abono">{{ dinero(abono.monto) }}</td>
                    </tr>
                  </tbody>
                </table>
                <p v-if="corte.notas" class="notas">📝 {{ corte.notas }}</p>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <p v-else class="empty-block">
      {{
        filtro === 'por-recibir'
          ? 'No hay cortes esperando que se cuente su dinero. 🎉'
          : 'Todavía no se ha recibido ningún corte.'
      }}
    </p>

    <!-- Contar el dinero. Contar de menos no bloquea: el faltante queda a la vista. -->
    <div v-if="recibiendo" class="modal-overlay" @click.self="recibiendo = null">
      <div class="modal-sheet" role="dialog" aria-label="Recibir el corte">
        <div class="modal-handle" />
        <p class="modal-title">Recibir el corte de {{ recibiendo.repartidorNombre }}</p>
        <p class="modal-texto">
          El sistema dice {{ dinero(recibiendo.montoCalculado) }} y él declaró
          {{ dinero(recibiendo.montoDeclarado) }}. Escribe lo que cuentes de verdad: si falta, el
          corte se recibe igual y lo que entregue después entra como abono.
        </p>

        <label class="form-label" for="contado">Dinero contado</label>
        <input
          id="contado"
          v-model.number="monto"
          class="form-input"
          type="number"
          inputmode="decimal"
          min="0"
          step="0.01"
        />

        <textarea
          v-model="nota"
          class="form-textarea"
          rows="2"
          maxlength="500"
          placeholder="Nota del conteo (opcional)"
        />

        <div class="modal-actions">
          <button type="button" class="btn-cancel" :disabled="guardando" @click="recibiendo = null">
            Volver
          </button>
          <button
            type="button"
            class="btn-primary"
            :disabled="guardando || monto === ''"
            @click="recibir"
          >
            {{ guardando ? 'Guardando…' : 'Recibir' }}
          </button>
        </div>
      </div>
    </div>

    <!-- El dinero que llega después del conteo. -->
    <div v-if="abonando" class="modal-overlay" @click.self="abonando = null">
      <div class="modal-sheet" role="dialog" aria-label="Registrar un abono">
        <div class="modal-handle" />
        <p class="modal-title">Abono de {{ abonando.repartidorNombre }}</p>
        <p class="modal-texto">
          Quedan {{ dinero(abonando.saldoPendiente) }} por entregar. El abono se guarda aparte: los
          montos del corte son la fotografía de aquel día y no se reescriben.
        </p>

        <label class="form-label" for="abono">Monto que entrega</label>
        <input
          id="abono"
          v-model.number="monto"
          class="form-input"
          type="number"
          inputmode="decimal"
          min="0.01"
          step="0.01"
        />

        <textarea
          v-model="nota"
          class="form-textarea"
          rows="2"
          maxlength="500"
          placeholder="De dónde salió (opcional)"
        />

        <div class="modal-actions">
          <button type="button" class="btn-cancel" :disabled="guardando" @click="abonando = null">
            Volver
          </button>
          <button
            type="button"
            class="btn-primary"
            :disabled="guardando || monto === '' || monto <= 0"
            @click="abonar"
          >
            {{ guardando ? 'Guardando…' : 'Registrar abono' }}
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
  min-width: 820px;
}

.nombre {
  display: block;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 12.5px;
  color: var(--ink);
  white-space: nowrap;
}

.tabla > tbody > tr > td.falta {
  color: var(--rojo);
}

.accion {
  width: 150px;
}

.accion button {
  width: 100%;
  padding: 8px 10px;
  font-size: 12px;
  white-space: nowrap;
}

.tabla-lineas.angosta {
  max-width: 620px;
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

.notas {
  margin: 8px 0 0;
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
