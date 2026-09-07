<script setup lang="ts">
/**
 * Cupones → Ciclo de vida (Word 4.9.1 y 4.9.5).
 *
 * Los cinco tipos son fijos: su `code` no se edita, solo sus parámetros. Los
 * contadores de generados y utilizados los calcula la API en vivo desde los
 * cupones realmente emitidos, no desde un contador almacenado.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero } from '@/utils/formato'
import type { TipoCicloVida, TipoDescuento } from '@/api/tipos'

const ui = useUiStore()

const CAMPOS = [
  'title',
  'description',
  'customerMessage',
  'discountType',
  'discountValue',
  'minimumOrderAmount',
  'maximumOrderAmount',
  'validityDays',
  'usageLimitPerCustomer',
  'inactivityDays',
  'birthdayWindowDays',
] as const

const tipos = ref<TipoCicloVida[]>([])
const cargando = ref(true)
const guardando = ref(false)
const errores = ref<Record<string, string>>({})
const erroresGenerales = ref<string[]>([])

const editando = ref<TipoCicloVida | null>(null)
const formulario = ref<Partial<TipoCicloVida>>({})

/** Emitir de prueba pide un clienteId explícito: la API no lo adivina. */
const clientePrueba = ref('')
const emitiendo = ref('')

onMounted(cargar)

async function cargar(): Promise<void> {
  cargando.value = true
  try {
    tipos.value = await http.get<TipoCicloVida[]>('/admin/cupones/ciclo-vida')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
}

function abrirEdicion(tipo: TipoCicloVida): void {
  editando.value = tipo
  formulario.value = { ...tipo }
  errores.value = {}
  erroresGenerales.value = []
}

async function guardar(): Promise<void> {
  if (!editando.value) return
  guardando.value = true
  errores.value = {}
  erroresGenerales.value = []
  try {
    const f = formulario.value
    await http.patch(`/admin/cupones/ciclo-vida/${editando.value.code}`, {
      title: f.title,
      description: f.description || undefined,
      customerMessage: f.customerMessage || undefined,
      discountType: f.discountType as TipoDescuento,
      discountValue: f.discountValue,
      minimumOrderAmount: f.minimumOrderAmount,
      maximumOrderAmount: f.maximumOrderAmount ?? null,
      validityDays: f.validityDays,
      usageLimitPerCustomer: f.usageLimitPerCustomer,
      inactivityDays: f.inactivityDays ?? null,
      birthdayWindowDays: f.birthdayWindowDays ?? null,
    })
    ui.exito('Tipo actualizado')
    editando.value = null
    await cargar()
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

async function alternarActivo(tipo: TipoCicloVida): Promise<void> {
  try {
    await http.patch(`/admin/cupones/ciclo-vida/${tipo.code}/activo`, { isActive: !tipo.isActive })
    tipo.isActive = !tipo.isActive
  } catch (fallo) {
    ui.errorDeApi(fallo)
  }
}

async function emitirPrueba(tipo: TipoCicloVida): Promise<void> {
  const clienteId = clientePrueba.value.trim()
  if (!clienteId) {
    ui.error('Escribe el id del cliente al que emitir el cupón de prueba.')
    return
  }
  emitiendo.value = tipo.code
  try {
    const { code } = await http.post<{ code: string }>(
      `/admin/cupones/ciclo-vida/${tipo.code}/emitir-prueba`,
      undefined,
      { query: { clienteId } },
    )
    ui.exito(`Cupón ${code} emitido`)
    await cargar()
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    emitiendo.value = ''
  }
}

function descuento(tipo: TipoCicloVida): string {
  return tipo.discountType === 'PERCENTAGE'
    ? `${tipo.discountValue}%`
    : dinero(tipo.discountValue)
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin/cupones" class="admin-back-inline">← Volver a Cupones</RouterLink>

    <div class="form-block prueba">
      <label class="form-label" for="cliente-prueba">Cliente para "emitir de prueba"</label>
      <input
        id="cliente-prueba"
        v-model="clientePrueba"
        class="form-input"
        placeholder="Id del cliente"
      />
      <p class="nota">
        El prototipo emitía al cliente con sesión activa; aquí se indica de forma explícita.
      </p>
    </div>

    <p v-if="cargando" class="empty-block">Cargando…</p>

    <template v-else>
      <article v-for="tipo in tipos" :key="tipo.code" class="tipo-card" :class="{ inactivo: !tipo.isActive }">
        <div class="tipo-cabecera">
          <div class="tipo-identidad">
            <span class="coupon-code-badge">{{ tipo.code }}</span>
            <p class="tipo-nombre">{{ tipo.name }}</p>
          </div>
          <label class="switch">
            <input type="checkbox" :checked="tipo.isActive" @change="alternarActivo(tipo)" />
            <span class="slider-switch" />
          </label>
        </div>

        <p class="tipo-titulo">{{ tipo.title }}</p>
        <p v-if="tipo.description" class="tipo-desc">{{ tipo.description }}</p>

        <!-- Contadores en vivo. -->
        <div class="coupon-stats-row">
          <div class="coupon-stat">
            <span class="n">{{ tipo.generados }}</span><span class="l">Generados</span>
          </div>
          <div class="coupon-stat">
            <span class="n">{{ tipo.utilizados }}</span><span class="l">Utilizados</span>
          </div>
          <div class="coupon-stat">
            <span class="n">{{ tipo.porcentajeUtilizacion }}%</span><span class="l">Utilización</span>
          </div>
        </div>

        <dl class="coupon-detail-grid">
          <div><dt>Descuento</dt><dd>{{ descuento(tipo) }}</dd></div>
          <div><dt>Compra mínima</dt><dd>{{ dinero(tipo.minimumOrderAmount) }}</dd></div>
          <div><dt>Vigencia</dt><dd>{{ tipo.validityDays }} días</dd></div>
          <div><dt>Usos por cliente</dt><dd>{{ tipo.usageLimitPerCustomer }}</dd></div>
          <div v-if="tipo.inactivityDays !== null">
            <dt>Inactividad</dt><dd>{{ tipo.inactivityDays }} días</dd>
          </div>
          <div v-if="tipo.birthdayWindowDays !== null">
            <dt>Ventana de cumpleaños</dt><dd>±{{ tipo.birthdayWindowDays }} días</dd>
          </div>
        </dl>

        <div class="coupon-actions-row">
          <button type="button" class="btn-secondary" @click="abrirEdicion(tipo)">Editar</button>
          <button
            type="button"
            class="btn-secondary"
            :disabled="emitiendo === tipo.code"
            @click="emitirPrueba(tipo)"
          >
            {{ emitiendo === tipo.code ? 'Emitiendo…' : 'Emitir de prueba' }}
          </button>
        </div>
      </article>
    </template>

    <!-- Edición de parámetros -->
    <div v-if="editando" class="modal-overlay" @click.self="editando = null">
      <div class="modal-sheet" role="dialog">
        <div class="modal-handle" />
        <p class="modal-title">✏️ {{ editando.name }}</p>
        <p class="nota codigo-fijo">El código <strong>{{ editando.code }}</strong> no es editable.</p>

        <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error">{{ mensaje }}</p>

        <label class="form-label" for="cv-title">Título visible</label>
        <input
          id="cv-title"
          v-model="formulario.title"
          class="form-input"
          :class="{ 'is-invalid': errores.title }"
        />
        <p v-if="errores.title" class="form-error">{{ errores.title }}</p>

        <label class="form-label" for="cv-desc">Descripción interna</label>
        <textarea id="cv-desc" v-model="formulario.description" class="form-textarea" />

        <label class="form-label" for="cv-msg">Mensaje al cliente</label>
        <textarea id="cv-msg" v-model="formulario.customerMessage" class="form-textarea" />

        <div class="form-row-2">
          <div>
            <label class="form-label" for="cv-tipo">Tipo de descuento</label>
            <select id="cv-tipo" v-model="formulario.discountType" class="select-input">
              <option value="PERCENTAGE">Porcentaje</option>
              <option value="FIXED">Monto fijo</option>
            </select>
          </div>
          <div>
            <label class="form-label" for="cv-valor">Valor</label>
            <input
              id="cv-valor"
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
            <label class="form-label" for="cv-min">Compra mínima</label>
            <input
              id="cv-min"
              v-model.number="formulario.minimumOrderAmount"
              class="form-input"
              type="number"
              step="0.01"
              min="0"
            />
          </div>
          <div>
            <label class="form-label" for="cv-max">Compra máxima</label>
            <input
              id="cv-max"
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
            <label class="form-label" for="cv-vig">Vigencia (días)</label>
            <input
              id="cv-vig"
              v-model.number="formulario.validityDays"
              class="form-input"
              type="number"
              min="1"
            />
          </div>
          <div>
            <label class="form-label" for="cv-usos">Usos por cliente</label>
            <input
              id="cv-usos"
              v-model.number="formulario.usageLimitPerCustomer"
              class="form-input"
              type="number"
              min="1"
            />
          </div>
        </div>

        <!-- Solo los tipos que tienen estos campos los muestran. -->
        <template v-if="editando.inactivityDays !== null">
          <label class="form-label" for="cv-inact">Días de inactividad</label>
          <input
            id="cv-inact"
            v-model.number="formulario.inactivityDays"
            class="form-input"
            type="number"
            min="1"
          />
        </template>

        <template v-if="editando.birthdayWindowDays !== null">
          <label class="form-label" for="cv-cumple">Ventana de cumpleaños (días)</label>
          <input
            id="cv-cumple"
            v-model.number="formulario.birthdayWindowDays"
            class="form-input"
            type="number"
            min="0"
          />
        </template>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" @click="editando = null">Cancelar</button>
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

.form-block.prueba {
  margin-bottom: 18px;
}

.nota {
  font-size: 10.5px;
  color: var(--muted);
  line-height: 1.45;
  margin: -4px 0 0;
}

.codigo-fijo {
  margin: -8px 0 14px;
}

.tipo-card {
  background: var(--white);
  border-radius: 16px;
  padding: 14px;
  margin-bottom: 14px;
  box-shadow: var(--shadow);
  border-left: 4px solid var(--sage);
}

.tipo-card.inactivo {
  opacity: 0.6;
  border-left-color: var(--muted);
}

.tipo-cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.tipo-identidad {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.coupon-code-badge {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 12px;
  color: var(--terracotta-dark);
  background: var(--cream-2);
  padding: 4px 10px;
  border-radius: 8px;
  letter-spacing: 0.03em;
}

.tipo-nombre {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13px;
  color: var(--ink);
  margin: 0;
}

.tipo-titulo {
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.4;
  margin: 0 0 4px;
}

.tipo-desc {
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.45;
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

.coupon-actions-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
</style>
