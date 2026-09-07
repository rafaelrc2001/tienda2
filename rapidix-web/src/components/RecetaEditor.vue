<script setup lang="ts">
/**
 * Modal de creación y edición de recetas.
 *
 * Lo comparten "Mis Recetas" del cliente (paso 17) y Administración → Recetas
 * (paso 22): el formulario es el mismo, cambia el endpoint al que se manda,
 * que decide quien lo usa.
 */
import { computed, ref, watch } from 'vue'
import { ErrorApi } from '@/api/http'
import SubidorImagen from '@/components/SubidorImagen.vue'
import type { CategoriaReceta, GuardarReceta, RecetaDetalle } from '@/api/tipos'

const props = withDefaults(
  defineProps<{
    /** Receta a editar. `null` = alta. */
    receta?: RecetaDetalle | null
    /** El switch de comunidad solo tiene sentido en recetas de cliente. */
    conCompartir?: boolean
    guardando?: boolean
  }>(),
  { receta: null, conCompartir: true, guardando: false },
)

const emit = defineEmits<{
  (e: 'guardar', datos: GuardarReceta): void
  (e: 'cerrar'): void
}>()

const CATEGORIAS: { clave: CategoriaReceta; etiqueta: string }[] = [
  { clave: 'desayuno', etiqueta: 'Desayuno' },
  { clave: 'comida', etiqueta: 'Comida' },
  { clave: 'cena', etiqueta: 'Cena' },
]

/** Campos con los que la API puede fallar, para pintar el error bajo cada uno. */
const CAMPOS = ['nombre', 'tiempo', 'porciones', 'categorias', 'ingredientes', 'pasos'] as const

const nombre = ref('')
const tiempo = ref('')
const porciones = ref<number | null>(null)
const emoji = ref('')
const imagenUrl = ref('')
const youtube = ref('')
const categorias = ref<CategoriaReceta[]>([])
const ingredientes = ref<{ nombre: string; cantidad: string }[]>([])
const pasos = ref<string[]>([])
const compartir = ref(false)

const nuevoIngrediente = ref({ nombre: '', cantidad: '' })
const nuevoPaso = ref('')

const erroresPorCampo = ref<Record<string, string>>({})
const erroresGenerales = ref<string[]>([])

const titulo = computed(() =>
  props.receta ? '✏️ Editar receta' : '✏️ Crear mi propia receta',
)

watch(
  () => props.receta,
  (receta) => {
    nombre.value = receta?.nombre ?? ''
    tiempo.value = receta?.tiempo ?? ''
    porciones.value = receta?.porciones ?? null
    emoji.value = receta?.emoji ?? ''
    imagenUrl.value = receta?.imagenUrl ?? ''
    youtube.value = receta?.youtube ?? ''
    categorias.value = (receta?.categorias ?? []) as CategoriaReceta[]
    ingredientes.value = receta?.ingredientes.map((i) => ({ ...i })) ?? []
    pasos.value = [...(receta?.pasos ?? [])]
    compartir.value = receta?.compartir ?? false
    erroresPorCampo.value = {}
    erroresGenerales.value = []
  },
  { immediate: true },
)

function alternarCategoria(clave: CategoriaReceta): void {
  const indice = categorias.value.indexOf(clave)
  if (indice >= 0) categorias.value.splice(indice, 1)
  else categorias.value.push(clave)
}

function agregarIngrediente(): void {
  const texto = nuevoIngrediente.value.nombre.trim()
  if (!texto) return
  ingredientes.value.push({ nombre: texto, cantidad: nuevoIngrediente.value.cantidad.trim() })
  nuevoIngrediente.value = { nombre: '', cantidad: '' }
}

function agregarPaso(): void {
  const texto = nuevoPaso.value.trim()
  if (!texto) return
  pasos.value.push(texto)
  nuevoPaso.value = ''
}

function enviar(): void {
  erroresPorCampo.value = {}
  erroresGenerales.value = []

  emit('guardar', {
    nombre: nombre.value.trim(),
    tiempo: tiempo.value.trim() || undefined,
    porciones: porciones.value ?? undefined,
    emoji: emoji.value.trim() || undefined,
    imagenUrl: imagenUrl.value.trim() || undefined,
    youtube: youtube.value.trim() || undefined,
    categorias: categorias.value,
    ingredientes: ingredientes.value.length > 0 ? ingredientes.value : undefined,
    pasos: pasos.value.length > 0 ? pasos.value : undefined,
    ...(props.conCompartir ? { compartir: compartir.value } : {}),
  })
}

/**
 * Reparte los errores de validación de la API bajo sus campos.
 * La vista que usa el editor la llama cuando `POST`/`PATCH` devuelve 400.
 */
function mostrarErrores(fallo: unknown): void {
  if (!(fallo instanceof ErrorApi)) return
  const { campos, generales } = fallo.porCampo(CAMPOS)
  erroresPorCampo.value = campos
  erroresGenerales.value = generales.length > 0 ? generales : [fallo.message]
}

defineExpose({ mostrarErrores })
</script>

<template>
  <div class="modal-overlay" @click.self="emit('cerrar')">
    <div class="modal-sheet" role="dialog" :aria-label="titulo">
      <div class="modal-handle" />
      <p class="modal-title">{{ titulo }}</p>

      <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error error-general">
        {{ mensaje }}
      </p>

      <label class="form-label" for="r-nombre">Nombre de la receta</label>
      <input
        id="r-nombre"
        v-model="nombre"
        class="form-input"
        :class="{ 'is-invalid': erroresPorCampo.nombre }"
        placeholder="Ej. Ensalada de pollo a la plancha"
      />
      <p v-if="erroresPorCampo.nombre" class="form-error">{{ erroresPorCampo.nombre }}</p>

      <div class="form-row-2">
        <div>
          <label class="form-label" for="r-tiempo">Tiempo de elaboración</label>
          <input id="r-tiempo" v-model="tiempo" class="form-input" placeholder="Ej. 25 min" />
        </div>
        <div>
          <label class="form-label" for="r-porciones">Porciones</label>
          <input
            id="r-porciones"
            v-model.number="porciones"
            class="form-input"
            type="number"
            min="1"
            placeholder="Ej. 4"
          />
        </div>
      </div>

      <div class="form-row-2">
        <div>
          <label class="form-label" for="r-emoji">Emoji</label>
          <input id="r-emoji" v-model="emoji" class="form-input" maxlength="8" placeholder="🥗" />
        </div>
        <div>
          <label class="form-label" for="r-youtube">Vídeo de YouTube</label>
          <input
            id="r-youtube"
            v-model="youtube"
            class="form-input"
            placeholder="https://youtu.be/…"
          />
        </div>
      </div>

      <label class="form-label">Foto de la receta (opcional)</label>
      <SubidorImagen v-model="imagenUrl" carpeta="recetas" :emoji="emoji" />

      <label class="form-label">Categorías</label>
      <div class="check-row">
        <button
          v-for="cat in CATEGORIAS"
          :key="cat.clave"
          type="button"
          class="check-chip"
          :class="{ checked: categorias.includes(cat.clave) }"
          @click="alternarCategoria(cat.clave)"
        >
          {{ cat.etiqueta }}
        </button>
      </div>
      <p v-if="erroresPorCampo.categorias" class="form-error">{{ erroresPorCampo.categorias }}</p>

      <label class="form-label">Ingredientes</label>
      <ul class="lista-dinamica">
        <li v-for="(ing, i) in ingredientes" :key="i">
          <span class="texto">
            <strong>{{ ing.nombre }}</strong>
            <span v-if="ing.cantidad"> · {{ ing.cantidad }}</span>
          </span>
          <button type="button" class="quitar" aria-label="Quitar" @click="ingredientes.splice(i, 1)">
            ✕
          </button>
        </li>
      </ul>
      <div class="ing-input-row">
        <input
          v-model="nuevoIngrediente.nombre"
          class="form-input"
          placeholder="Ingrediente"
          @keydown.enter.prevent="agregarIngrediente"
        />
        <input
          v-model="nuevoIngrediente.cantidad"
          class="form-input"
          placeholder="Cantidad"
          @keydown.enter.prevent="agregarIngrediente"
        />
        <button type="button" class="ing-add-btn" aria-label="Añadir" @click="agregarIngrediente">
          +
        </button>
      </div>

      <label class="form-label">Pasos</label>
      <ol class="lista-dinamica numerada">
        <li v-for="(paso, i) in pasos" :key="i">
          <span class="texto">{{ paso }}</span>
          <button type="button" class="quitar" aria-label="Quitar" @click="pasos.splice(i, 1)">
            ✕
          </button>
        </li>
      </ol>
      <div class="ing-input-row">
        <input
          v-model="nuevoPaso"
          class="form-input"
          placeholder="Describe el paso"
          @keydown.enter.prevent="agregarPaso"
        />
        <button type="button" class="ing-add-btn" aria-label="Añadir" @click="agregarPaso">+</button>
      </div>

      <div v-if="conCompartir" class="toggle-row">
        <div>
          <p class="t-lbl">Compartir con la comunidad</p>
          <p class="t-sub">Otros clientes podrán verla en la pestaña Comunidad.</p>
        </div>
        <label class="switch">
          <input v-model="compartir" type="checkbox" />
          <span class="slider-switch" />
        </label>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn-cancel" @click="emit('cerrar')">Cancelar</button>
        <button type="button" class="btn-primary" :disabled="guardando" @click="enviar">
          {{ guardando ? 'Guardando…' : 'Guardar' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.error-general {
  margin: 0 0 12px;
}

.check-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
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

.lista-dinamica {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
}

.lista-dinamica.numerada {
  list-style: decimal;
  padding-left: 20px;
}

.lista-dinamica li {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--white);
  border-radius: 11px;
  padding: 9px 12px;
  margin-bottom: 6px;
  font-size: 12.5px;
  color: var(--ink);
}

.lista-dinamica .texto {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.lista-dinamica .quitar {
  background: none;
  border: none;
  color: var(--terracotta);
  font-size: 13px;
  cursor: pointer;
  flex-shrink: 0;
  padding: 2px 4px;
}

.ing-input-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  align-items: flex-start;
}

.ing-input-row .form-input {
  margin-bottom: 0;
  min-width: 0;
}

.ing-input-row input:first-child {
  flex: 1.4;
}

.ing-input-row input:nth-child(2) {
  flex: 1;
}

.ing-add-btn {
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border-radius: 11px;
  border: none;
  background: var(--sage);
  color: var(--white);
  font-size: 20px;
  font-weight: 800;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
