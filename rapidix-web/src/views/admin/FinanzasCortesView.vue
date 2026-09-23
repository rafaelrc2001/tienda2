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
  void cargar()
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

    <template v-else-if="cortes.length > 0">
      <article v-for="corte in cortes" :key="corte.id" class="corte">
        <header class="cabecera">
          <div>
            <p class="repartidor">🛵 {{ corte.repartidorNombre }}</p>
            <p class="fecha">
              Cerrado {{ fechaHora(corte.cerradoEn) }} · {{ corte.pedidos }} pedido(s)
            </p>
          </div>
          <span class="total">{{ dinero(corte.montoCalculado) }}</span>
        </header>

        <div class="fila">
          <span>Dice el sistema</span><span>{{ dinero(corte.montoCalculado) }}</span>
        </div>
        <div class="fila"><span>Declaró</span><span>{{ dinero(corte.montoDeclarado) }}</span></div>
        <div class="fila" :class="{ falta: corte.diferencia < 0 }">
          <span>{{ corte.diferencia < 0 ? 'Dice traer de menos' : 'Diferencia declarada' }}</span>
          <span>{{ dinero(corte.diferencia) }}</span>
        </div>

        <template v-if="corte.montoRecibido !== null">
          <div class="fila">
            <span>Contado por {{ corte.recibidoPorNombre ?? '—' }}</span>
            <span>{{ dinero(corte.montoRecibido) }}</span>
          </div>
          <div class="fila fuerte" :class="{ falta: corte.saldoPendiente > 0 }">
            <span>{{ corte.saldoPendiente > 0 ? 'Le falta entregar' : 'Saldado' }}</span>
            <span>{{ dinero(corte.saldoPendiente) }}</span>
          </div>
        </template>

        <ul v-if="corte.abonos.length > 0" class="abonos">
          <li v-for="abono in corte.abonos" :key="abono.id">
            <span class="importe">{{ dinero(abono.monto) }}</span>
            <span class="detalle">
              {{ fechaHora(abono.creadoEn) }} · {{ abono.registradoPorNombre }}
              <span v-if="abono.nota" class="sub">{{ abono.nota }}</span>
            </span>
          </li>
        </ul>

        <p v-if="corte.notas" class="notas">📝 {{ corte.notas }}</p>

        <div class="botonera">
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
        </div>
      </article>
    </template>

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

.corte {
  background: var(--white);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
  padding: 14px;
  margin-bottom: 12px;
}

.cabecera {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 8px;
}

.repartidor {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  color: var(--ink);
}

.fecha {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--muted);
}

.total {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 15px;
  color: var(--ink);
  white-space: nowrap;
}

.fila {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
  color: var(--ink);
  padding: 3px 0;
}

.fila.fuerte {
  font-family: var(--font-heading);
  font-weight: 800;
  border-top: 1px solid var(--line);
  margin-top: 4px;
  padding-top: 7px;
}

.fila.falta span {
  color: var(--rojo);
}

.abonos {
  list-style: none;
  margin: 8px 0 0;
  padding: 8px 0 0;
  border-top: 1px solid var(--line);
}

.abonos li {
  display: flex;
  gap: 10px;
  padding: 3px 0;
  font-size: 12px;
}

.abonos .importe {
  flex-shrink: 0;
  font-family: var(--font-heading);
  font-weight: 700;
  color: var(--verde-dark);
}

.abonos .detalle {
  flex: 1;
  min-width: 0;
  color: var(--muted);
}

.abonos .sub {
  display: block;
  color: var(--ink);
}

.notas {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--ink);
  line-height: 1.45;
}

.botonera {
  margin-top: 12px;
}

.botonera button {
  width: 100%;
  padding: 10px 8px;
  font-size: 12.5px;
}

.modal-texto {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.45;
}
</style>
