<script setup lang="ts">
/**
 * Cupones → Campañas (Word 4.9.2 y 4.9.3).
 *
 * CRUD completo con el constructor de segmentos. Dos reglas del backend que
 * la interfaz respeta al pie de la letra:
 *
 *  - `contiene` solo se ofrece sobre `ciudad` y `estado`; el evaluador lo
 *    trata como comparación de texto y no tiene sentido sobre un número.
 *  - `REFERRAL` está en el enum pero **nunca califica**: el programa de
 *    referidos no está implementado, así que sale deshabilitado y explicado.
 */
import { computed, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fecha } from '@/utils/formato'
import { ETIQUETA_ATRIBUTO, normalizarRegla, operadoresDe } from '@/utils/segmentos'
import {
  ATRIBUTOS_SEGMENTO,
  type Campania,
  type Fuente,
  type ReglaSegmento,
  type TipoAudiencia,
} from '@/api/tipos'

const ui = useUiStore()

const CAMPOS = [
  'name',
  'title',
  'description',
  'customerMessage',
  'discountType',
  'discountValue',
  'minimumOrderAmount',
  'maximumOrderAmount',
  'startsAt',
  'endsAt',
  'usageLimitTotal',
  'usageLimitPerCustomer',
  'targetType',
  'sourceCode',
  'segmentRules',
  'categorias',
] as const

const AUDIENCIAS: { valor: TipoAudiencia; etiqueta: string; nota?: string }[] = [
  { valor: 'ALL', etiqueta: 'Todos los clientes' },
  { valor: 'NEW_CUSTOMERS', etiqueta: 'Clientes nuevos' },
  { valor: 'EXISTING_CUSTOMERS', etiqueta: 'Clientes existentes' },
  { valor: 'SOURCE', etiqueta: 'Por fuente de adquisición' },
  { valor: 'SEGMENT', etiqueta: 'Segmento personalizado' },
  {
    valor: 'REFERRAL',
    etiqueta: 'Referidos',
    nota: 'El programa de referidos no está implementado: una campaña con esta audiencia nunca emitiría cupones.',
  },
]

const campanias = ref<Campania[]>([])
const fuentes = ref<Fuente[]>([])
const categorias = ref<string[]>([])
const cargando = ref(true)
const guardando = ref(false)
const errores = ref<Record<string, string>>({})
const erroresGenerales = ref<string[]>([])

const modalAbierto = ref(false)
const editando = ref<Campania | null>(null)
const clientePrueba = ref('')
const emitiendo = ref('')

const formulario = ref({
  name: '',
  title: '',
  description: '',
  customerMessage: '',
  discountType: 'PERCENTAGE' as Campania['discountType'],
  discountValue: 10,
  minimumOrderAmount: 0,
  maximumOrderAmount: null as number | null,
  startsAt: '',
  endsAt: '',
  usageLimitTotal: 0,
  usageLimitPerCustomer: 1,
  targetType: 'ALL' as TipoAudiencia,
  sourceCode: '',
  segmentRules: [] as ReglaSegmento[],
  categorias: [] as string[],
})

const esSegmento = computed(() => formulario.value.targetType === 'SEGMENT')
const esFuente = computed(() => formulario.value.targetType === 'SOURCE')

onMounted(async () => {
  try {
    const [listaCampanias, listaFuentes, listaCategorias] = await Promise.all([
      http.get<Campania[]>('/admin/cupones/campanias'),
      http.get<Fuente[]>('/admin/cupones/fuentes'),
      http.get<string[]>('/categorias'),
    ])
    campanias.value = listaCampanias
    fuentes.value = listaFuentes
    categorias.value = listaCategorias
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
})

async function recargar(): Promise<void> {
  campanias.value = await http.get<Campania[]>('/admin/cupones/campanias')
}

function abrirAlta(): void {
  editando.value = null
  formulario.value = {
    name: '',
    title: '',
    description: '',
    customerMessage: '',
    discountType: 'PERCENTAGE',
    discountValue: 10,
    minimumOrderAmount: 0,
    maximumOrderAmount: null,
    startsAt: '',
    endsAt: '',
    usageLimitTotal: 0,
    usageLimitPerCustomer: 1,
    targetType: 'ALL',
    sourceCode: '',
    segmentRules: [],
    categorias: [],
  }
  errores.value = {}
  erroresGenerales.value = []
  modalAbierto.value = true
}

function abrirEdicion(campania: Campania): void {
  editando.value = campania
  formulario.value = {
    name: campania.name,
    title: campania.title,
    description: campania.description ?? '',
    customerMessage: campania.customerMessage ?? '',
    discountType: campania.discountType,
    discountValue: campania.discountValue,
    minimumOrderAmount: campania.minimumOrderAmount,
    maximumOrderAmount: campania.maximumOrderAmount,
    startsAt: campania.startsAt?.slice(0, 10) ?? '',
    endsAt: campania.endsAt?.slice(0, 10) ?? '',
    usageLimitTotal: campania.usageLimitTotal,
    usageLimitPerCustomer: campania.usageLimitPerCustomer,
    targetType: campania.targetType,
    sourceCode: campania.sourceCode ?? '',
    segmentRules: campania.segmentRules.map((r) => ({ ...r })),
    categorias: [...campania.categorias],
  }
  errores.value = {}
  erroresGenerales.value = []
  modalAbierto.value = true
}

function agregarRegla(): void {
  formulario.value.segmentRules.push({ attr: 'pedidos', op: '>', value: '' })
}

/** Si el atributo deja de ser de texto, `contiene` ya no vale para esa regla. */
function alCambiarAtributo(regla: ReglaSegmento): void {
  regla.op = normalizarRegla(regla).op
}

function alternarCategoria(categoria: string): void {
  const indice = formulario.value.categorias.indexOf(categoria)
  if (indice >= 0) formulario.value.categorias.splice(indice, 1)
  else formulario.value.categorias.push(categoria)
}

async function guardar(): Promise<void> {
  guardando.value = true
  errores.value = {}
  erroresGenerales.value = []
  try {
    const f = formulario.value
    const cuerpo = {
      name: f.name.trim(),
      title: f.title.trim(),
      description: f.description.trim() || undefined,
      customerMessage: f.customerMessage.trim() || undefined,
      discountType: f.discountType,
      discountValue: f.discountValue,
      minimumOrderAmount: f.minimumOrderAmount,
      maximumOrderAmount: f.maximumOrderAmount ?? null,
      startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null,
      endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null,
      usageLimitTotal: f.usageLimitTotal,
      usageLimitPerCustomer: f.usageLimitPerCustomer,
      targetType: f.targetType,
      // La API solo espera `sourceCode` cuando la audiencia es SOURCE.
      sourceCode: esFuente.value ? f.sourceCode || null : null,
      segmentRules: esSegmento.value ? f.segmentRules : [],
      categorias: f.categorias,
    }

    if (editando.value) {
      await http.patch(`/admin/cupones/campanias/${editando.value.id}`, cuerpo)
      ui.exito('Campaña actualizada')
    } else {
      await http.post('/admin/cupones/campanias', cuerpo)
      ui.exito('Campaña creada')
    }
    modalAbierto.value = false
    await recargar()
  } catch (fallo) {
    if (fallo instanceof ErrorApi) {
      const { campos, generales } = fallo.porCampo(CAMPOS)
      errores.value = campos
      erroresGenerales.value = generales.length > 0 ? generales : [fallo.message]
    } else {
      ui.errorDeApi(fallo)
    }
  } finally {
    guardando.value = false
  }
}

async function alternarActivo(campania: Campania): Promise<void> {
  try {
    await http.patch(`/admin/cupones/campanias/${campania.id}/activo`, {
      isActive: !campania.isActive,
    })
    campania.isActive = !campania.isActive
  } catch (fallo) {
    ui.errorDeApi(fallo)
  }
}

async function eliminar(campania: Campania): Promise<void> {
  if (!confirm(`¿Eliminar la campaña «${campania.name}»?`)) return
  try {
    await http.delete(`/admin/cupones/campanias/${campania.id}`)
    ui.exito('Campaña eliminada')
    await recargar()
  } catch (fallo) {
    ui.errorDeApi(fallo)
  }
}

async function emitirPrueba(campania: Campania): Promise<void> {
  const clienteId = clientePrueba.value.trim()
  if (!clienteId) {
    ui.error('Escribe el id del cliente al que emitir el cupón de prueba.')
    return
  }
  emitiendo.value = campania.id
  try {
    const { code } = await http.post<{ code: string }>(
      `/admin/cupones/campanias/${campania.id}/emitir-prueba`,
      undefined,
      { query: { clienteId } },
    )
    ui.exito(`Cupón ${code} emitido`)
    await recargar()
  } catch (fallo) {
    // Si el cliente no cumple las reglas del segmento, la API lo dice.
    ui.errorDeApi(fallo)
  } finally {
    emitiendo.value = ''
  }
}

function etiquetaAudiencia(valor: TipoAudiencia): string {
  return AUDIENCIAS.find((a) => a.valor === valor)?.etiqueta ?? valor
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin/cupones" class="admin-back-inline">← Volver a Cupones</RouterLink>

    <div class="form-block">
      <label class="form-label" for="cliente-prueba">Cliente para "emitir de prueba"</label>
      <input
        id="cliente-prueba"
        v-model="clientePrueba"
        class="form-input"
        placeholder="Id del cliente"
      />
    </div>

    <button type="button" class="btn-primary ancho" @click="abrirAlta">+ Nueva campaña</button>

    <p v-if="cargando" class="empty-block">Cargando…</p>

    <template v-else-if="campanias.length > 0">
      <article
        v-for="campania in campanias"
        :key="campania.id"
        class="campania-card"
        :class="{ inactiva: !campania.isActive }"
      >
        <div class="cabecera">
          <div class="identidad">
            <p class="nombre">{{ campania.name }}</p>
            <span class="coupon-tipo-tag">{{ etiquetaAudiencia(campania.targetType) }}</span>
          </div>
          <label class="switch">
            <input
              type="checkbox"
              :checked="campania.isActive"
              @change="alternarActivo(campania)"
            />
            <span class="slider-switch" />
          </label>
        </div>

        <p class="titulo">{{ campania.title }}</p>

        <div class="coupon-stats-row">
          <div class="coupon-stat">
            <span class="n">{{ campania.generados }}</span><span class="l">Generados</span>
          </div>
          <div class="coupon-stat">
            <span class="n">{{ campania.utilizados }}</span><span class="l">Utilizados</span>
          </div>
          <div class="coupon-stat">
            <span class="n">{{ campania.porcentajeUtilizacion }}%</span>
            <span class="l">Utilización</span>
          </div>
        </div>

        <dl class="coupon-detail-grid">
          <div>
            <dt>Descuento</dt>
            <dd>
              {{
                campania.discountType === 'PERCENTAGE'
                  ? `${campania.discountValue}%`
                  : dinero(campania.discountValue)
              }}
            </dd>
          </div>
          <div><dt>Compra mínima</dt><dd>{{ dinero(campania.minimumOrderAmount) }}</dd></div>
          <div v-if="campania.startsAt"><dt>Desde</dt><dd>{{ fecha(campania.startsAt) }}</dd></div>
          <div v-if="campania.endsAt"><dt>Hasta</dt><dd>{{ fecha(campania.endsAt) }}</dd></div>
          <div>
            <dt>Límite total</dt>
            <dd>{{ campania.usageLimitTotal === 0 ? 'Sin límite' : campania.usageLimitTotal }}</dd>
          </div>
          <div v-if="campania.sourceCode">
            <dt>Fuente</dt><dd>{{ campania.sourceCode }}</dd>
          </div>
        </dl>

        <div v-if="campania.segmentRules.length > 0" class="reglas-resumen">
          <p class="reglas-titulo">Segmento</p>
          <ul>
            <li v-for="(regla, i) in campania.segmentRules" :key="i">
              {{ ETIQUETA_ATRIBUTO[regla.attr] }} {{ regla.op }} {{ regla.value }}
            </li>
          </ul>
        </div>

        <div v-if="campania.categorias.length > 0" class="cats">
          <span v-for="cat in campania.categorias" :key="cat" class="mini-tag">{{ cat }}</span>
        </div>

        <div class="coupon-actions-row">
          <button type="button" class="btn-secondary" @click="abrirEdicion(campania)">Editar</button>
          <button
            type="button"
            class="btn-secondary"
            :disabled="emitiendo === campania.id"
            @click="emitirPrueba(campania)"
          >
            {{ emitiendo === campania.id ? 'Emitiendo…' : 'Emitir de prueba' }}
          </button>
          <button
            type="button"
            class="coupon-delete-btn"
            aria-label="Eliminar"
            @click="eliminar(campania)"
          >
            🗑
          </button>
        </div>
      </article>
    </template>

    <p v-else class="empty-block">Todavía no hay campañas.</p>

    <!-- Alta y edición -->
    <div v-if="modalAbierto" class="modal-overlay" @click.self="modalAbierto = false">
      <div class="modal-sheet" role="dialog">
        <div class="modal-handle" />
        <p class="modal-title">{{ editando ? '✏️ Editar campaña' : '🎯 Nueva campaña' }}</p>

        <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error">{{ mensaje }}</p>

        <label class="form-label" for="c-name">Nombre interno</label>
        <input
          id="c-name"
          v-model="formulario.name"
          class="form-input"
          :class="{ 'is-invalid': errores.name }"
          placeholder="No se repite entre campañas"
        />
        <p v-if="errores.name" class="form-error">{{ errores.name }}</p>

        <label class="form-label" for="c-title">Título visible para el cliente</label>
        <input
          id="c-title"
          v-model="formulario.title"
          class="form-input"
          :class="{ 'is-invalid': errores.title }"
        />
        <p v-if="errores.title" class="form-error">{{ errores.title }}</p>

        <label class="form-label" for="c-msg">Mensaje al cliente</label>
        <textarea id="c-msg" v-model="formulario.customerMessage" class="form-textarea" />

        <div class="form-row-2">
          <div>
            <label class="form-label" for="c-tipo">Tipo de descuento</label>
            <select id="c-tipo" v-model="formulario.discountType" class="select-input">
              <option value="PERCENTAGE">Porcentaje</option>
              <option value="FIXED">Monto fijo</option>
            </select>
          </div>
          <div>
            <label class="form-label" for="c-valor">Valor</label>
            <input
              id="c-valor"
              v-model.number="formulario.discountValue"
              class="form-input"
              type="number"
              step="0.01"
              min="0"
            />
          </div>
        </div>

        <div class="form-row-2">
          <div>
            <label class="form-label" for="c-min">Compra mínima</label>
            <input
              id="c-min"
              v-model.number="formulario.minimumOrderAmount"
              class="form-input"
              type="number"
              step="0.01"
              min="0"
            />
          </div>
          <div>
            <label class="form-label" for="c-max">Compra máxima</label>
            <input
              id="c-max"
              v-model.number="formulario.maximumOrderAmount"
              class="form-input"
              type="number"
              step="0.01"
              min="0"
              placeholder="Sin límite"
            />
          </div>
        </div>

        <div class="form-row-2">
          <div>
            <label class="form-label" for="c-desde">Desde</label>
            <input id="c-desde" v-model="formulario.startsAt" class="form-input" type="date" />
          </div>
          <div>
            <label class="form-label" for="c-hasta">Hasta</label>
            <input id="c-hasta" v-model="formulario.endsAt" class="form-input" type="date" />
          </div>
        </div>

        <div class="form-row-2">
          <div>
            <label class="form-label" for="c-lim-total">Límite total (0 = sin límite)</label>
            <input
              id="c-lim-total"
              v-model.number="formulario.usageLimitTotal"
              class="form-input"
              type="number"
              min="0"
            />
          </div>
          <div>
            <label class="form-label" for="c-lim-cliente">Usos por cliente</label>
            <input
              id="c-lim-cliente"
              v-model.number="formulario.usageLimitPerCustomer"
              class="form-input"
              type="number"
              min="1"
            />
          </div>
        </div>

        <!-- Audiencia -->
        <label class="form-label" for="c-audiencia">Audiencia</label>
        <select
          id="c-audiencia"
          v-model="formulario.targetType"
          class="select-input"
          :class="{ 'is-invalid': errores.targetType }"
        >
          <option
            v-for="audiencia in AUDIENCIAS"
            :key="audiencia.valor"
            :value="audiencia.valor"
            :disabled="audiencia.valor === 'REFERRAL'"
          >
            {{ audiencia.etiqueta }}{{ audiencia.valor === 'REFERRAL' ? ' — no disponible' : '' }}
          </option>
        </select>
        <p class="nota">
          {{ AUDIENCIAS.find((a) => a.valor === 'REFERRAL')?.nota }}
        </p>

        <!-- SOURCE obliga a elegir una fuente. -->
        <template v-if="esFuente">
          <label class="form-label" for="c-fuente">Fuente de adquisición</label>
          <select
            id="c-fuente"
            v-model="formulario.sourceCode"
            class="select-input"
            :class="{ 'is-invalid': errores.sourceCode }"
          >
            <option value="">Elige una fuente…</option>
            <option v-for="fuente in fuentes" :key="fuente.id" :value="fuente.code">
              {{ fuente.name }} ({{ fuente.code }})
            </option>
          </select>
          <p v-if="errores.sourceCode" class="form-error">{{ errores.sourceCode }}</p>
        </template>

        <!-- Constructor de segmentos -->
        <template v-if="esSegmento">
          <label class="form-label">Reglas del segmento</label>
          <div v-for="(regla, i) in formulario.segmentRules" :key="i" class="regla">
            <select
              v-model="regla.attr"
              class="select-input"
              @change="alCambiarAtributo(regla)"
            >
              <option v-for="attr in ATRIBUTOS_SEGMENTO" :key="attr" :value="attr">
                {{ ETIQUETA_ATRIBUTO[attr] }}
              </option>
            </select>
            <select v-model="regla.op" class="select-input operador">
              <option v-for="op in operadoresDe(regla.attr)" :key="op" :value="op">{{ op }}</option>
            </select>
            <input v-model="regla.value" class="form-input valor" placeholder="Valor" />
            <button
              type="button"
              class="quitar-regla"
              aria-label="Quitar regla"
              @click="formulario.segmentRules.splice(i, 1)"
            >
              ✕
            </button>
          </div>

          <button type="button" class="btn-secondary" @click="agregarRegla">+ Añadir regla</button>
          <p class="nota">
            El operador <strong>contiene</strong> solo se ofrece sobre Ciudad y Estado: sobre un
            número no tiene sentido.
          </p>
          <p v-if="errores.segmentRules" class="form-error">{{ errores.segmentRules }}</p>
        </template>

        <!-- Restricción por categorías -->
        <label class="form-label restriccion">Restringir a categorías</label>
        <div class="check-row">
          <button
            v-for="categoria in categorias"
            :key="categoria"
            type="button"
            class="check-chip"
            :class="{ checked: formulario.categorias.includes(categoria) }"
            @click="alternarCategoria(categoria)"
          >
            {{ categoria }}
          </button>
        </div>
        <p class="nota">Sin ninguna seleccionada, el cupón aplica a todo el catálogo.</p>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" @click="modalAbierto = false">Cancelar</button>
          <button type="button" class="btn-primary" :disabled="guardando" @click="guardar">
            {{ guardando ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pantalla {
  padding: 12px 18px 24px;
}

.admin-back-inline {
  display: inline-block;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  padding: 0 0 14px;
  text-decoration: none;
}

.form-block {
  margin-bottom: 14px;
}

.ancho {
  width: 100%;
  margin-bottom: 14px;
}

.campania-card {
  background: var(--white);
  border-radius: 16px;
  padding: 14px;
  margin-bottom: 14px;
  box-shadow: var(--shadow);
  border-left: 4px solid var(--sage);
}

.campania-card.inactiva {
  opacity: 0.6;
  border-left-color: var(--muted);
}

.cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.identidad {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.nombre {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  color: var(--ink);
  margin: 0;
}

.coupon-tipo-tag {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 9.5px;
  color: var(--navy);
  background: #e4e9f0;
  padding: 3px 8px;
  border-radius: 7px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.titulo {
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.4;
  margin: 0 0 12px;
}

.coupon-stats-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.coupon-stat {
  flex: 1;
  background: var(--cream);
  border-radius: 10px;
  padding: 8px 6px;
  text-align: center;
}

.coupon-stat .n {
  display: block;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 14px;
  color: var(--terracotta-dark);
}

.coupon-stat .l {
  display: block;
  font-size: 9px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-weight: 700;
  margin-top: 2px;
}

.coupon-detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  margin: 0 0 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

.coupon-detail-grid div {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.coupon-detail-grid dt {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 9.5px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.coupon-detail-grid dd {
  font-size: 12px;
  color: var(--ink);
  font-weight: 600;
  margin: 0;
}

.reglas-resumen {
  background: var(--cream);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 10px;
}

.reglas-titulo {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 9.5px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin: 0 0 6px;
}

.reglas-resumen ul {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 12px;
  color: var(--ink);
  line-height: 1.6;
}

.cats {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.coupon-actions-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.coupon-delete-btn {
  background: var(--cream-2);
  border: none;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  color: var(--terracotta);
  font-size: 16px;
  cursor: pointer;
  flex-shrink: 0;
}

/* ---- Constructor de segmentos ---- */

.regla {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  margin-bottom: 8px;
}

.regla .select-input,
.regla .form-input {
  margin-bottom: 0;
  min-width: 0;
}

.regla > .select-input:first-child {
  flex: 1.6;
}

.regla .operador {
  flex: 0 0 74px;
}

.regla .valor {
  flex: 1;
}

.quitar-regla {
  flex-shrink: 0;
  width: 38px;
  height: 42px;
  border-radius: 11px;
  border: none;
  background: var(--cream-2);
  color: var(--terracotta);
  font-size: 13px;
  cursor: pointer;
}

.check-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.check-chip {
  padding: 9px 14px;
  border-radius: 12px;
  border: 1.5px solid var(--line);
  background: var(--white);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}

.check-chip.checked {
  background: var(--sage);
  border-color: var(--sage);
  color: var(--white);
}

.restriccion {
  margin-top: 14px;
}

.nota {
  font-size: 10.5px;
  color: var(--muted);
  line-height: 1.45;
  margin: -4px 0 12px;
}
</style>
