<script setup lang="ts">
/**
 * Configuración → Niveles de fidelidad (HU-17).
 *
 * Estos niveles no existen en el Word ni en el prototipo —allí Bronce y Plata
 * estaban escritos a mano—, así que se configuran aquí. Cada uno dice desde
 * cuánto gasto se alcanza y qué % de cashback gana quien está en él.
 *
 * Aquí van también los dos valores del Monedero electrónico (multiplicador y
 * compra mínima). Viven en los parámetros del negocio, que se guardan de una
 * pieza: se leen enteros y se reenvían con solo esos dos cambiados.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero } from '@/utils/formato'
import type { NivelFidelidad, Parametros } from '@/api/tipos'

const ui = useUiStore()

const CAMPOS = ['nombre', 'umbralGasto', 'orden', 'porcentaje'] as const

// ---- Valores del Monedero electrónico ----

const CAMPOS_MONEDERO = ['multiplicadorCashback', 'montoMinimoCashback'] as const

const parametros = ref<Parametros | null>(null)
const guardandoMonedero = ref(false)
const erroresMonedero = ref<Record<string, string>>({})
const erroresGeneralesMonedero = ref<string[]>([])

async function cargarParametros(): Promise<void> {
  try {
    parametros.value = await http.get<Parametros>('/admin/configuracion/parametros')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  }
}

async function guardarMonedero(): Promise<void> {
  if (!parametros.value) return
  guardandoMonedero.value = true
  erroresMonedero.value = {}
  erroresGeneralesMonedero.value = []
  try {
    // Se relee antes de guardar: el envío pudo cambiar en Parámetros mientras tanto.
    const actuales = await http.get<Parametros>('/admin/configuracion/parametros')
    parametros.value = await http.put<Parametros>('/admin/configuracion/parametros', {
      ...actuales,
      multiplicadorCashback: parametros.value.multiplicadorCashback,
      montoMinimoCashback: parametros.value.montoMinimoCashback,
    })
    ui.exito('Monedero electrónico guardado')
  } catch (fallo) {
    if (fallo instanceof ErrorApi) {
      const { campos, generales } = fallo.porCampo(CAMPOS_MONEDERO)
      erroresMonedero.value = campos
      erroresGeneralesMonedero.value = generales.length > 0 ? generales : [fallo.message]
    } else {
      ui.errorDeApi(fallo)
    }
  } finally {
    guardandoMonedero.value = false
  }
}

const niveles = ref<NivelFidelidad[]>([])
const cargando = ref(true)
const guardando = ref(false)
const errores = ref<Record<string, string>>({})
const erroresGenerales = ref<string[]>([])

const modalAbierto = ref(false)
const editando = ref<NivelFidelidad | null>(null)
const formulario = ref({ nombre: '', umbralGasto: 0, orden: 1, porcentaje: 1 })

onMounted(() => {
  void cargar()
  void cargarParametros()
})

async function cargar(): Promise<void> {
  cargando.value = true
  try {
    niveles.value = await http.get<NivelFidelidad[]>('/admin/configuracion/niveles')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
}

function abrirAlta(): void {
  editando.value = null
  formulario.value = {
    nombre: '',
    umbralGasto: 0,
    // Se propone el siguiente escalón libre.
    orden: niveles.value.reduce((max, n) => Math.max(max, n.orden), 0) + 1,
    porcentaje: 1,
  }
  errores.value = {}
  erroresGenerales.value = []
  modalAbierto.value = true
}

function abrirEdicion(nivel: NivelFidelidad): void {
  editando.value = nivel
  formulario.value = {
    nombre: nivel.nombre,
    umbralGasto: Number(nivel.umbralGasto),
    orden: nivel.orden,
    porcentaje: Number(nivel.porcentaje),
  }
  errores.value = {}
  erroresGenerales.value = []
  modalAbierto.value = true
}

async function guardar(): Promise<void> {
  guardando.value = true
  errores.value = {}
  erroresGenerales.value = []
  try {
    const cuerpo = {
      nombre: formulario.value.nombre.trim(),
      umbralGasto: formulario.value.umbralGasto,
      orden: formulario.value.orden,
      porcentaje: formulario.value.porcentaje,
    }
    if (editando.value) {
      await http.patch(`/admin/configuracion/niveles/${editando.value.id}`, cuerpo)
      ui.exito('Nivel actualizado')
    } else {
      await http.post('/admin/configuracion/niveles', cuerpo)
      ui.exito('Nivel creado')
    }
    modalAbierto.value = false
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

async function eliminar(nivel: NivelFidelidad): Promise<void> {
  if (!confirm(`¿Eliminar el nivel «${nivel.nombre}»?`)) return
  try {
    await http.delete(`/admin/configuracion/niveles/${nivel.id}`)
    ui.exito('Nivel eliminado')
    await cargar()
  } catch (fallo) {
    ui.errorDeApi(fallo)
  }
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin/configuracion" class="admin-back-inline">
      ← Volver a Configuración
    </RouterLink>

    <button type="button" class="btn-primary ancho" @click="abrirAlta">+ Nuevo nivel</button>

    <p v-if="cargando" class="empty-block">Cargando…</p>

    <div v-else-if="niveles.length > 0" class="tabla-envoltorio">
      <table class="tabla">
        <thead>
          <tr>
            <th class="num">Orden</th>
            <th>Nivel</th>
            <th class="num">Monedero electrónico</th>
            <th class="num">Desde (venta acumulada)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="nivel in niveles" :key="nivel.id">
            <td class="num">{{ nivel.orden }}</td>
            <td>
              <span class="folio">{{ nivel.nombre }}</span>
            </td>
            <td class="num">{{ Number(nivel.porcentaje) }} %</td>
            <td class="num">{{ dinero(Number(nivel.umbralGasto)) }}</td>
            <td class="acciones">
              <button
                type="button"
                class="accion"
                :aria-label="`Editar ${nivel.nombre}`"
                @click="abrirEdicion(nivel)"
              >
                ✏️
              </button>
              <button
                type="button"
                class="coupon-delete-btn"
                :aria-label="`Eliminar ${nivel.nombre}`"
                @click="eliminar(nivel)"
              >
                🗑
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else class="empty-block">Todavía no hay niveles configurados.</p>

    <!-- Movido aquí desde Parámetros del negocio: va junto al % de cada nivel. -->
    <template v-if="parametros">
      <p v-for="(mensaje, i) in erroresGeneralesMonedero" :key="i" class="form-error">
        {{ mensaje }}
      </p>

      <div class="form-block">
        <label class="form-label" for="multiplicador"
          >Multiplicador del Monedero electrónico (× veces)</label
        >
        <input
          id="multiplicador"
          v-model.number="parametros.multiplicadorCashback"
          class="form-input"
          :class="{ 'is-invalid': erroresMonedero.multiplicadorCashback }"
          type="number"
          step="0.01"
          min="0"
        />
        <p v-if="erroresMonedero.multiplicadorCashback" class="form-error">
          {{ erroresMonedero.multiplicadorCashback }}
        </p>
        <p class="nota">
          El % de Monedero electrónico lo pone el nivel de cada cliente (la lista de arriba). Este
          número es cuántas veces vale al acreditarse: con 2, $18 generados se acreditan como $36.
        </p>

        <label class="form-label" for="minimo"
          >Compra mínima para generar Monedero electrónico</label
        >
        <input
          id="minimo"
          v-model.number="parametros.montoMinimoCashback"
          class="form-input"
          :class="{ 'is-invalid': erroresMonedero.montoMinimoCashback }"
          type="number"
          step="0.01"
          min="0"
        />
        <p v-if="erroresMonedero.montoMinimoCashback" class="form-error">
          {{ erroresMonedero.montoMinimoCashback }}
        </p>
        <p class="nota">
          Se mide solo sobre los productos que participan en el Monedero electrónico, y hay que
          <strong>superarlo</strong>: con el monto exacto todavía no se genera.
        </p>
      </div>

      <button
        type="button"
        class="btn-primary ancho"
        :disabled="guardandoMonedero"
        @click="guardarMonedero"
      >
        {{ guardandoMonedero ? 'Guardando…' : 'Guardar Monedero electrónico' }}
      </button>
    </template>

    <div v-if="modalAbierto" class="modal-overlay" @click.self="modalAbierto = false">
      <div class="modal-sheet" role="dialog">
        <div class="modal-handle" />
        <p class="modal-title">{{ editando ? '✏️ Editar nivel' : '🏅 Nuevo nivel' }}</p>

        <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error">{{ mensaje }}</p>

        <label class="form-label" for="niv-nombre">Nombre</label>
        <input
          id="niv-nombre"
          v-model="formulario.nombre"
          class="form-input"
          :class="{ 'is-invalid': errores.nombre }"
          placeholder="Ej. Bronce"
        />
        <p v-if="errores.nombre" class="form-error">{{ errores.nombre }}</p>

        <div class="form-row-2">
          <div>
            <label class="form-label" for="niv-umbral">Venta acumulada</label>
            <input
              id="niv-umbral"
              v-model.number="formulario.umbralGasto"
              class="form-input"
              :class="{ 'is-invalid': errores.umbralGasto }"
              type="number"
              step="0.01"
              min="0"
            />
          </div>
          <div>
            <label class="form-label" for="niv-orden">Orden</label>
            <input
              id="niv-orden"
              v-model.number="formulario.orden"
              class="form-input"
              :class="{ 'is-invalid': errores.orden }"
              type="number"
              min="1"
            />
          </div>
        </div>
        <p v-if="errores.umbralGasto" class="form-error">{{ errores.umbralGasto }}</p>
        <p v-if="errores.orden" class="form-error">{{ errores.orden }}</p>
        <p class="nota">El nivel 1 es el de entrada y debe tener venta acumulada 0.</p>

        <label class="form-label" for="niv-porcentaje">Monedero electrónico (%)</label>
        <input
          id="niv-porcentaje"
          v-model.number="formulario.porcentaje"
          class="form-input"
          :class="{ 'is-invalid': errores.porcentaje }"
          type="number"
          step="0.01"
          min="0"
          max="100"
        />
        <p v-if="errores.porcentaje" class="form-error">{{ errores.porcentaje }}</p>

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

.ancho {
  width: 100%;
  margin-bottom: 14px;
}

.tabla {
  min-width: 460px;
}

.acciones {
  text-align: right;
  white-space: nowrap;
}

.accion {
  background: var(--cream);
  border: none;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
}

.coupon-delete-btn {
  background: var(--cream-2);
  border: none;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: var(--terracotta);
  font-size: 14px;
  cursor: pointer;
  margin-left: 6px;
}

.nota {
  font-size: 10.5px;
  color: var(--muted);
  line-height: 1.45;
  margin: -4px 0 12px;
}

/* El bloque del Monedero va a lo ancho de la pantalla, como la tabla de niveles. */
.form-block {
  margin: 14px 0;
}

.form-block .nota:last-child {
  margin-bottom: 0;
}

.nota strong {
  color: var(--ink);
}
</style>
