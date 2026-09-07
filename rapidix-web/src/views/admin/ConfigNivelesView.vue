<script setup lang="ts">
/**
 * Configuración → Niveles de fidelidad.
 *
 * Estos niveles no existen en el Word ni en el prototipo —allí Bronce y Plata
 * estaban escritos a mano—, así que se configuran aquí. La pantalla avisa de
 * que **los umbrales del seed son provisionales**.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero } from '@/utils/formato'
import type { NivelFidelidad } from '@/api/tipos'

const ui = useUiStore()

const CAMPOS = ['nombre', 'umbralGasto', 'orden'] as const

const niveles = ref<NivelFidelidad[]>([])
const cargando = ref(true)
const guardando = ref(false)
const errores = ref<Record<string, string>>({})
const erroresGenerales = ref<string[]>([])

const modalAbierto = ref(false)
const editando = ref<NivelFidelidad | null>(null)
const formulario = ref({ nombre: '', umbralGasto: 0, orden: 1 })

onMounted(cargar)

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

    <div class="aviso-provisional">
      <p>
        <strong>Los umbrales que trae el sistema son provisionales.</strong> Los niveles no venían
        definidos en la especificación funcional: revísalos antes de anunciarlos a tus clientes.
      </p>
    </div>

    <button type="button" class="btn-primary ancho" @click="abrirAlta">+ Nuevo nivel</button>

    <p v-if="cargando" class="empty-block">Cargando…</p>

    <ul v-else-if="niveles.length > 0" class="lista">
      <li v-for="nivel in niveles" :key="nivel.id">
        <span class="orden">{{ nivel.orden }}</span>
        <div class="info">
          <p class="nombre">{{ nivel.nombre }}</p>
          <p class="umbral">Desde {{ dinero(Number(nivel.umbralGasto)) }} de gasto acumulado</p>
        </div>
        <button type="button" class="accion" aria-label="Editar" @click="abrirEdicion(nivel)">
          ✏️
        </button>
        <button
          type="button"
          class="coupon-delete-btn"
          aria-label="Eliminar"
          @click="eliminar(nivel)"
        >
          🗑
        </button>
      </li>
    </ul>

    <p v-else class="empty-block">Todavía no hay niveles configurados.</p>

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
            <label class="form-label" for="niv-umbral">Umbral de gasto</label>
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
        <p class="nota">El nivel 1 es el de entrada y debe tener umbral 0.</p>

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

.aviso-provisional {
  background: linear-gradient(135deg, #fff3dc, #fde6bc);
  border: 1.5px solid var(--gold-dark);
  border-radius: 14px;
  padding: 12px 14px;
  margin-bottom: 14px;
}

.aviso-provisional p {
  font-size: 11.5px;
  color: var(--ink);
  line-height: 1.5;
  margin: 0;
}

.ancho {
  width: 100%;
  margin-bottom: 14px;
}

.lista {
  list-style: none;
  margin: 0;
  padding: 0;
}

.lista li {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--white);
  border-radius: 14px;
  padding: 12px 14px;
  margin-bottom: 10px;
  box-shadow: var(--shadow);
}

.orden {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--cream-2);
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.info {
  flex: 1;
  min-width: 0;
}

.nombre {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13px;
  color: var(--ink);
  margin: 0;
}

.umbral {
  font-size: 11px;
  color: var(--muted);
  margin: 2px 0 0;
}

.accion {
  background: var(--cream);
  border: none;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  cursor: pointer;
  font-size: 14px;
  flex-shrink: 0;
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

.nota {
  font-size: 10.5px;
  color: var(--muted);
  line-height: 1.45;
  margin: -4px 0 12px;
}
</style>
