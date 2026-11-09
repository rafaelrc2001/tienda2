<script setup lang="ts">
/**
 * Cupones → Fuentes de adquisición (Word 4.9.4).
 *
 * Cada fuente tiene su enlace `rapidix.mx/r/CODIGO`. Ese enlace es lo que se
 * reparte; cuando alguien se da de alta desde él, el código viaja como
 * `fuenteCodigo` y la atribución queda hecha en el primer contacto.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import type { Fuente, TipoFuente } from '@/api/tipos'

const ui = useUiStore()

const CAMPOS = ['name', 'code', 'type'] as const

const TIPOS: { valor: TipoFuente; etiqueta: string }[] = [
  { valor: 'FACEBOOK', etiqueta: 'Facebook' },
  { valor: 'INSTAGRAM', etiqueta: 'Instagram' },
  { valor: 'INFLUENCER', etiqueta: 'Influencer' },
  { valor: 'QR', etiqueta: 'Código QR' },
  { valor: 'REFERIDO', etiqueta: 'Referido' },
  { valor: 'GOOGLE', etiqueta: 'Google' },
  { valor: 'OTRO', etiqueta: 'Otro' },
]

const fuentes = ref<Fuente[]>([])
const cargando = ref(true)
const guardando = ref(false)
const errores = ref<Record<string, string>>({})
const erroresGenerales = ref<string[]>([])

const modalAbierto = ref(false)
const editando = ref<Fuente | null>(null)
const formulario = ref({ name: '', code: '', type: 'OTRO' as TipoFuente, isActive: true })

onMounted(cargar)

async function cargar(): Promise<void> {
  cargando.value = true
  try {
    fuentes.value = await http.get<Fuente[]>('/admin/cupones/fuentes')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
}

function abrirAlta(): void {
  editando.value = null
  formulario.value = { name: '', code: '', type: 'OTRO', isActive: true }
  errores.value = {}
  erroresGenerales.value = []
  modalAbierto.value = true
}

function abrirEdicion(fuente: Fuente): void {
  editando.value = fuente
  formulario.value = {
    name: fuente.name,
    code: fuente.code,
    type: fuente.type,
    isActive: fuente.isActive,
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
      name: formulario.value.name.trim(),
      code: formulario.value.code.trim(),
      type: formulario.value.type,
      isActive: formulario.value.isActive,
    }
    if (editando.value) {
      await http.patch(`/admin/cupones/fuentes/${editando.value.id}`, cuerpo)
      ui.exito('Fuente actualizada')
    } else {
      await http.post('/admin/cupones/fuentes', cuerpo)
      ui.exito('Fuente creada')
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

async function eliminar(fuente: Fuente): Promise<void> {
  if (!confirm(`¿Eliminar la fuente «${fuente.name}»?`)) return
  try {
    await http.delete(`/admin/cupones/fuentes/${fuente.id}`)
    ui.exito('Fuente eliminada')
    await cargar()
  } catch (fallo) {
    ui.errorDeApi(fallo)
  }
}

async function copiarEnlace(enlace: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(enlace)
    ui.exito('Enlace copiado')
  } catch {
    ui.error('No pudimos copiar el enlace. Cópialo a mano.')
  }
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin/cupones" class="admin-back-inline">← Volver a Cupones</RouterLink>

    <button type="button" class="btn-primary ancho" @click="abrirAlta">+ Nueva fuente</button>

    <p v-if="cargando" class="empty-block">Cargando…</p>

    <template v-else-if="fuentes.length > 0">
      <article
        v-for="fuente in fuentes"
        :key="fuente.id"
        class="fuente-card"
        :class="{ inactiva: !fuente.isActive }"
      >
        <div class="cabecera">
          <div class="identidad">
            <p class="nombre">{{ fuente.name }}</p>
            <span class="coupon-tipo-tag">{{ fuente.type }}</span>
          </div>
          <span class="atribuidos">
            <strong>{{ fuente.clientesAtribuidos }}</strong> clientes
          </span>
        </div>

        <div class="enlace-row">
          <code class="enlace">{{ fuente.enlace }}</code>
          <button type="button" class="btn-secondary" @click="copiarEnlace(fuente.enlace)">
            Copiar
          </button>
        </div>

        <div class="acciones">
          <button type="button" class="btn-secondary" @click="abrirEdicion(fuente)">Editar</button>
          <button
            type="button"
            class="coupon-delete-btn"
            aria-label="Eliminar"
            @click="eliminar(fuente)"
          >
            🗑
          </button>
        </div>
      </article>
    </template>

    <p v-else class="empty-block">Todavía no hay fuentes de adquisición.</p>

    <div v-if="modalAbierto" class="modal-overlay" @click.self="modalAbierto = false">
      <div class="modal-sheet" role="dialog">
        <div class="modal-handle" />
        <p class="modal-title">{{ editando ? '✏️ Editar fuente' : '🔗 Nueva fuente' }}</p>

        <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error">{{ mensaje }}</p>

        <label class="form-label" for="f-name">Nombre</label>
        <input
          id="f-name"
          v-model="formulario.name"
          class="form-input"
          :class="{ 'is-invalid': errores.name }"
          placeholder="Ej. Campaña de Instagram de mayo"
        />
        <p v-if="errores.name" class="form-error">{{ errores.name }}</p>

        <label class="form-label" for="f-code">Código del enlace</label>
        <input
          id="f-code"
          v-model="formulario.code"
          class="form-input"
          :class="{ 'is-invalid': errores.code }"
          placeholder="Ej. IG05"
        />
        <p v-if="errores.code" class="form-error">{{ errores.code }}</p>
        <p class="nota">
          Entre 2 y 20 letras o números, sin espacios ni símbolos: va en una URL y se dicta de viva
          voz.
        </p>

        <label class="form-label" for="f-type">Tipo</label>
        <select id="f-type" v-model="formulario.type" class="select-input">
          <option v-for="tipo in TIPOS" :key="tipo.valor" :value="tipo.valor">
            {{ tipo.etiqueta }}
          </option>
        </select>

        <div class="toggle-row">
          <div>
            <p class="t-lbl">Fuente activa</p>
            <p class="t-sub">Una fuente inactiva ya no atribuye altas nuevas.</p>
          </div>
          <label class="switch">
            <input v-model="formulario.isActive" type="checkbox" />
            <span class="slider-switch" />
          </label>
        </div>

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

.fuente-card {
  background: var(--white);
  border-radius: 16px;
  padding: 14px;
  margin-bottom: 12px;
  box-shadow: var(--shadow);
  border-left: 4px solid var(--sage);
}

.fuente-card.inactiva {
  opacity: 0.6;
  border-left-color: var(--muted);
}

.cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
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
  font-weight: 700;
  font-size: 13px;
  color: var(--ink);
  margin: 0;
}

.coupon-tipo-tag {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 9.5px;
  color: var(--navy);
  background: #e8f5e9;
  padding: 3px 8px;
  border-radius: 7px;
  letter-spacing: 0.03em;
}

.atribuidos {
  font-size: 11px;
  color: var(--muted);
  flex-shrink: 0;
}

.atribuidos strong {
  font-family: var(--font-heading);
  font-size: 14px;
  color: var(--terracotta-dark);
}

.enlace-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--cream);
  border-radius: 11px;
  padding: 10px 12px;
  margin-bottom: 10px;
}

.enlace {
  flex: 1;
  min-width: 0;
  font-family: var(--font-body);
  font-size: 11.5px;
  color: var(--ink);
  overflow-x: auto;
  white-space: nowrap;
}

.acciones {
  display: flex;
  gap: 8px;
  align-items: center;
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
