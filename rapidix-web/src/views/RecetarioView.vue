<script setup lang="ts">
/**
 * Recetario (Word 4.4).
 *
 * Cuatro pestañas: Recetario, Mis Recetas, Comunidad e Historial. Las tres
 * primeras salen de `GET /recetas?pestana=`; el Historial tiene endpoint
 * propio. Buscador por nombre e ingrediente con sugerencias, y filtro por
 * desayuno / comida / cena.
 *
 * El bloqueo por inactividad **no se comprueba aquí**: mirar la lista nunca
 * bloquea (Word 5, regla 11). Se maneja en el detalle.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { http } from '@/api/http'
import { useRecetarioStore, type PestanaRecetario } from '@/stores/recetario'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { fecha } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import RecetaEditor from '@/components/RecetaEditor.vue'
import type {
  CategoriaReceta,
  EntradaHistorial,
  GuardarReceta,
  RecetaResumen,
} from '@/api/tipos'

const recetario = useRecetarioStore()
const auth = useAuthStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()

const recetas = ref<RecetaResumen[]>([])
const historial = ref<EntradaHistorial[]>([])
const cargando = ref(true)
const sugerenciasAbiertas = ref(false)

const editorAbierto = ref(false)
const guardando = ref(false)
const editor = ref<InstanceType<typeof RecetaEditor> | null>(null)

const PESTANAS: { clave: PestanaRecetario; etiqueta: string; soloCliente: boolean }[] = [
  { clave: 'recetario', etiqueta: 'Recetario', soloCliente: false },
  { clave: 'mias', etiqueta: 'Mis Recetas', soloCliente: true },
  { clave: 'comunidad', etiqueta: 'Comunidad', soloCliente: false },
  { clave: 'historial', etiqueta: 'Historial', soloCliente: true },
]

const CATEGORIAS: { clave: CategoriaReceta | 'todas'; etiqueta: string }[] = [
  { clave: 'todas', etiqueta: 'Todas' },
  { clave: 'desayuno', etiqueta: 'Desayuno' },
  { clave: 'comida', etiqueta: 'Comida' },
  { clave: 'cena', etiqueta: 'Cena' },
]

const pestanasVisibles = computed(() =>
  PESTANAS.filter((p) => !p.soloCliente || auth.esCliente),
)

/**
 * Sugerencias del buscador: nombres de receta que casan con lo escrito.
 * Salen de lo ya cargado, sin ir a la API por cada pulsación.
 */
const sugerencias = computed(() => {
  const termino = recetario.busqueda.trim().toLowerCase()
  if (termino.length < 2) return []
  return recetas.value
    .filter((r) => r.nombre.toLowerCase().includes(termino))
    .slice(0, 6)
    .map((r) => r.nombre)
})

onMounted(() => {
  // El Home manda aquí con la categoría ya elegida.
  const desdeQuery = route.query.categoria
  if (typeof desdeQuery === 'string') {
    recetario.categoria = CATEGORIAS.some((c) => c.clave === desdeQuery)
      ? (desdeQuery as CategoriaReceta)
      : 'todas'
  }
  void cargar()
})

// Pestaña y categoría recargan al momento.
watch(
  () => [recetario.pestana, recetario.categoria] as const,
  () => {
    void cargar()
  },
)

/*
 * La búsqueda también la resuelve la API, porque mira dentro de los
 * ingredientes y eso no viaja en el listado. Pero teclear no puede lanzar una
 * petición por pulsación: se espera a que el cliente pare de escribir.
 */
let temporizadorBusqueda: ReturnType<typeof setTimeout> | undefined

watch(
  () => recetario.busqueda,
  () => {
    clearTimeout(temporizadorBusqueda)
    temporizadorBusqueda = setTimeout(() => void cargar(), 300)
  },
)

onBeforeUnmount(() => clearTimeout(temporizadorBusqueda))

async function cargar(): Promise<void> {
  cargando.value = true
  try {
    if (recetario.pestana === 'historial') {
      historial.value = await http.get<EntradaHistorial[]>('/recetario/historial')
    } else {
      recetas.value = await http.get<RecetaResumen[]>('/recetas', {
        query: {
          pestana: recetario.pestana,
          categoria: recetario.categoria === 'todas' ? undefined : recetario.categoria,
          q: recetario.busqueda.trim() || undefined,
        },
      })
    }
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
}

function elegirSugerencia(nombre: string): void {
  recetario.busqueda = nombre
  sugerenciasAbiertas.value = false
}

async function crearReceta(datos: GuardarReceta): Promise<void> {
  guardando.value = true
  try {
    await http.post('/recetas', datos)
    editorAbierto.value = false
    ui.exito('Receta creada')
    recetario.pestana = 'mias'
    await cargar()
  } catch (fallo) {
    editor.value?.mostrarErrores(fallo)
  } finally {
    guardando.value = false
  }
}

function abrir(id: string): void {
  void router.push(`/recetario/${id}`)
}
</script>

<template>
  <div class="recetario">
    <div class="subtab-row">
      <button
        v-for="p in pestanasVisibles"
        :key="p.clave"
        type="button"
        class="subtab"
        :class="{ active: recetario.pestana === p.clave }"
        @click="recetario.pestana = p.clave"
      >
        {{ p.etiqueta }}
      </button>
    </div>

    <template v-if="recetario.pestana !== 'historial'">
      <div class="recetario-search-wrap">
        <input
          v-model="recetario.busqueda"
          class="form-input"
          type="search"
          placeholder="Buscar por nombre o ingrediente…"
          @focus="sugerenciasAbiertas = true"
          @blur="sugerenciasAbiertas = false"
        />
        <button
          v-if="recetario.busqueda"
          type="button"
          class="clear-search-btn"
          aria-label="Limpiar búsqueda"
          @click="recetario.busqueda = ''"
        >
          ✕
        </button>

        <ul
          v-if="sugerenciasAbiertas && sugerencias.length > 0"
          class="search-suggestions open"
        >
          <li
            v-for="nombre in sugerencias"
            :key="nombre"
            class="sug-item"
            @mousedown.prevent="elegirSugerencia(nombre)"
          >
            {{ nombre }}
          </li>
        </ul>
      </div>

      <div class="pill-row">
        <button
          v-for="cat in CATEGORIAS"
          :key="cat.clave"
          type="button"
          class="pill"
          :class="{ active: recetario.categoria === cat.clave }"
          @click="recetario.categoria = cat.clave"
        >
          {{ cat.etiqueta }}
        </button>
      </div>

      <div v-if="recetario.pestana === 'mias' && auth.esCliente" class="crear-wrap">
        <button type="button" class="btn-primary ancho" @click="editorAbierto = true">
          ✏️ Crear mi propia receta
        </button>
      </div>

      <SkeletonList v-if="cargando" />

      <template v-else-if="recetas.length > 0">
        <article
          v-for="receta in recetas"
          :key="receta.id"
          class="recipe-card"
          @click="abrir(receta.id)"
        >
          <div class="recipe-top">
            <div class="recipe-emoji">
              <img v-if="receta.imagenUrl" :src="receta.imagenUrl" :alt="receta.nombre" />
              <template v-else>{{ receta.emoji ?? '🍲' }}</template>
            </div>
            <div class="recipe-info">
              <p class="recipe-name">{{ receta.nombre }}</p>
              <p class="recipe-meta">
                <span v-if="receta.tiempo">⏱ {{ receta.tiempo }}</span>
                <span v-if="receta.porciones">🍽 {{ receta.porciones }} porciones</span>
                <span v-if="receta.calificacionPromedio !== null">
                  ⭐ {{ receta.calificacionPromedio.toFixed(1) }} ({{ receta.totalCalificaciones }})
                </span>
              </p>
              <div class="recipe-cats">
                <span v-for="cat in receta.categorias" :key="cat" class="mini-tag">{{ cat }}</span>
                <span v-if="!receta.esPropia && receta.origin !== 'NEGOCIO'" class="mini-tag author">
                  {{ receta.autorNombre }}
                </span>
                <span v-if="receta.guardada" class="mini-tag">Guardada</span>
              </div>
            </div>
            <span class="card-chevron">›</span>
          </div>
        </article>
      </template>

      <p v-else-if="recetario.busqueda" class="empty-block">
        No encontramos recetas con «{{ recetario.busqueda }}».
      </p>
      <p v-else-if="recetario.pestana === 'mias'" class="empty-block">
        Todavía no tienes recetas propias ni guardadas.
      </p>
      <p v-else class="empty-block">Todavía no hay recetas en esta sección.</p>
    </template>

    <!-- Historial: qué cocinó y cuándo. -->
    <template v-else>
      <SkeletonList v-if="cargando" :cantidad="3" />
      <template v-else-if="historial.length > 0">
        <article
          v-for="(entrada, i) in historial"
          :key="`${entrada.recetaId}-${i}`"
          class="recipe-card"
          @click="abrir(entrada.recetaId)"
        >
          <div class="recipe-top">
            <div class="recipe-emoji">{{ entrada.emoji ?? '🍲' }}</div>
            <div class="recipe-info">
              <p class="recipe-name">{{ entrada.receta }}</p>
              <p class="recipe-meta">
                <span>{{ fecha(entrada.fecha) }}</span>
                <span class="mini-tag">{{ entrada.categoria }}</span>
              </p>
            </div>
            <span class="card-chevron">›</span>
          </div>
        </article>
      </template>
      <p v-else class="empty-block">Todavía no has marcado ninguna receta como cocinada.</p>
    </template>

    <RecetaEditor
      v-if="editorAbierto"
      ref="editor"
      :guardando="guardando"
      @guardar="crearReceta"
      @cerrar="editorAbierto = false"
    />
  </div>
</template>

<style scoped>
.recetario-search-wrap {
  position: relative;
  margin: 8px 18px 4px;
}

.recetario-search-wrap .form-input {
  padding-right: 38px;
}

.clear-search-btn {
  position: absolute;
  right: 8px;
  top: 21px;
  transform: translateY(-50%);
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  background: var(--cream-2);
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.search-suggestions {
  position: absolute;
  top: calc(100% - 6px);
  left: 0;
  right: 0;
  background: var(--white);
  border: 1.5px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
  z-index: 25;
  max-height: 220px;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 0;
}

.sug-item {
  padding: 10px 14px;
  font-size: 12.5px;
  color: var(--ink);
  cursor: pointer;
  border-bottom: 1px solid var(--line);
  font-family: var(--font-body);
}

.sug-item:last-child {
  border-bottom: none;
}

.sug-item:hover {
  background: var(--cream);
}

.crear-wrap {
  margin: 4px 18px 12px;
}

.ancho {
  width: 100%;
}

.recipe-card {
  margin: 0 18px 14px;
  background: var(--white);
  border-radius: 18px;
  box-shadow: var(--shadow);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.12s ease;
}

.recipe-card:active {
  transform: scale(0.98);
}

.recipe-top {
  display: flex;
  gap: 12px;
  padding: 14px 14px 10px;
  align-items: flex-start;
}

.recipe-emoji {
  width: 64px;
  height: 64px;
  border-radius: 14px;
  background: var(--cream-2);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  overflow: hidden;
}

.recipe-emoji img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.recipe-info {
  flex: 1;
  min-width: 0;
}

.recipe-name {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 14.5px;
  color: var(--ink);
  line-height: 1.25;
  margin: 0;
}

.recipe-meta {
  font-size: 11.5px;
  color: var(--muted);
  margin: 4px 0 0;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.recipe-cats {
  display: flex;
  gap: 5px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.card-chevron {
  font-size: 20px;
  color: var(--muted);
  flex-shrink: 0;
  align-self: center;
}
</style>
