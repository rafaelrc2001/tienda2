<script setup lang="ts">
/**
 * Administración → Recetas (HU-A03): las oficiales del Recetario.
 *
 * Reutiliza el `<RecetaEditor>` del paso 17 con `conCompartir` apagado: el
 * switch de comunidad solo aplica a recetas de cliente.
 */
import { onMounted, ref } from 'vue'
import { http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import SkeletonList from '@/components/SkeletonList.vue'
import RecetaEditor from '@/components/RecetaEditor.vue'
import type { GuardarReceta, RecetaDetalle, RecetaResumen } from '@/api/tipos'

const ui = useUiStore()

const recetas = ref<RecetaResumen[]>([])
const cargando = ref(true)
const busqueda = ref('')

const modalAbierto = ref(false)
const enEdicion = ref<RecetaDetalle | null>(null)
const guardando = ref(false)
const editor = ref<InstanceType<typeof RecetaEditor> | null>(null)

let temporizador: ReturnType<typeof setTimeout> | undefined

onMounted(cargar)

async function cargar(): Promise<void> {
  cargando.value = true
  try {
    recetas.value = await http.get<RecetaResumen[]>('/admin/recetas', {
      query: { q: busqueda.value.trim() || undefined },
    })
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
}

function buscar(): void {
  clearTimeout(temporizador)
  temporizador = setTimeout(() => void cargar(), 300)
}

function abrirAlta(): void {
  enEdicion.value = null
  modalAbierto.value = true
}

/**
 * El listado devuelve resúmenes; el editor necesita ingredientes y pasos, así
 * que se pide el detalle antes de abrir.
 */
async function abrirEdicion(id: string): Promise<void> {
  try {
    enEdicion.value = await http.get<RecetaDetalle>(`/recetas/${id}`)
    modalAbierto.value = true
  } catch (fallo) {
    ui.errorDeApi(fallo)
  }
}

async function guardar(datos: GuardarReceta): Promise<void> {
  guardando.value = true
  try {
    if (enEdicion.value) {
      await http.patch(`/admin/recetas/${enEdicion.value.id}`, datos)
      ui.exito('Receta actualizada')
    } else {
      await http.post('/admin/recetas', datos)
      ui.exito('Receta publicada')
    }
    modalAbierto.value = false
    await cargar()
  } catch (fallo) {
    editor.value?.mostrarErrores(fallo)
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <div class="admin-recetas">
    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <div class="barra-superior">
      <input
        v-model="busqueda"
        class="form-input"
        type="search"
        placeholder="Buscar receta…"
        @input="buscar"
      />
      <button type="button" class="btn-primary nueva" @click="abrirAlta">+ Nueva</button>
    </div>
    <p class="admin-list-count">{{ recetas.length }} recetas oficiales</p>

    <SkeletonList v-if="cargando" :cantidad="3" />

    <template v-else-if="recetas.length > 0">
      <article
        v-for="receta in recetas"
        :key="receta.id"
        class="fila-receta"
        @click="abrirEdicion(receta.id)"
      >
        <div class="media">
          <img v-if="receta.imagenUrl" :src="receta.imagenUrl" :alt="receta.nombre" />
          <template v-else>{{ receta.emoji ?? '🍳' }}</template>
        </div>

        <div class="info">
          <p class="nombre">{{ receta.nombre }}</p>
          <p class="detalle">
            <span v-if="receta.tiempo">⏱ {{ receta.tiempo }}</span>
            <span v-if="receta.porciones"> · {{ receta.porciones }} porciones</span>
            <span v-if="receta.calificacionPromedio !== null">
              · ⭐ {{ receta.calificacionPromedio.toFixed(1) }}
            </span>
          </p>
          <div class="cats">
            <span v-for="cat in receta.categorias" :key="cat" class="mini-tag">{{ cat }}</span>
          </div>
        </div>

        <span class="chev">›</span>
      </article>
    </template>

    <p v-else class="empty-block">
      {{ busqueda ? 'Ninguna receta coincide con la búsqueda.' : 'Todavía no hay recetas oficiales.' }}
    </p>

    <RecetaEditor
      v-if="modalAbierto"
      ref="editor"
      :receta="enEdicion"
      :con-compartir="false"
      :guardando="guardando"
      @guardar="guardar"
      @cerrar="modalAbierto = false"
    />
  </div>
</template>

<style scoped>
.admin-recetas {
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

.barra-superior {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.barra-superior .form-input {
  flex: 1;
  min-width: 0;
  margin-bottom: 0;
}

.nueva {
  flex-shrink: 0;
  height: 42px;
}

.admin-list-count {
  font-size: 11.5px;
  color: var(--sage);
  font-weight: 700;
  font-family: var(--font-heading);
  margin: 8px 0 14px;
}

.fila-receta {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--white);
  border-radius: 14px;
  padding: 12px;
  margin-bottom: 10px;
  box-shadow: var(--shadow);
  cursor: pointer;
}

.fila-receta .media {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background: var(--cream-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  flex-shrink: 0;
  overflow: hidden;
}

.fila-receta .media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.fila-receta .info {
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

.detalle {
  font-size: 11px;
  color: var(--muted);
  margin: 3px 0 0;
}

.cats {
  display: flex;
  gap: 5px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.chev {
  font-size: 18px;
  color: var(--muted);
  flex-shrink: 0;
}
</style>
