<script setup lang="ts">
/**
 * Configuración → Noticias y avisos (HU-A07).
 *
 * Lo que se publica aquí es lo que el cliente ve en Destacados, y lo que
 * alimenta la insignia de no leídos.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { useDestacadosStore } from '@/stores/destacados'
import { fecha } from '@/utils/formato'
import type { Destacados } from '@/api/tipos'

const ui = useUiStore()
const destacadosStore = useDestacadosStore()

const datos = ref<Destacados | null>(null)
const cargando = ref(true)
const publicando = ref(false)
const errores = ref<Record<string, string>>({})

const nuevaNoticia = ref({ titulo: '', badge: '', desc: '' })
const nuevoAviso = ref({ titulo: '', icon: '', desc: '' })

onMounted(cargar)

async function cargar(): Promise<void> {
  cargando.value = true
  try {
    datos.value = await http.get<Destacados>('/destacados')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
}

/** Tras publicar o borrar, el store se refresca para que la insignia cuadre. */
async function refrescar(): Promise<void> {
  await cargar()
  await destacadosStore.cargar().catch(() => {})
}

function mostrarFallo(fallo: unknown, campos: readonly string[]): void {
  if (fallo instanceof ErrorApi) {
    const { campos: porCampo, generales } = fallo.porCampo(campos)
    errores.value = porCampo
    if (generales.length > 0) ui.error(generales[0])
  } else {
    ui.errorDeApi(fallo)
  }
}

async function publicarNoticia(): Promise<void> {
  publicando.value = true
  errores.value = {}
  try {
    await http.post('/admin/configuracion/noticias', {
      titulo: nuevaNoticia.value.titulo.trim(),
      badge: nuevaNoticia.value.badge.trim() || undefined,
      desc: nuevaNoticia.value.desc.trim() || undefined,
    })
    nuevaNoticia.value = { titulo: '', badge: '', desc: '' }
    ui.exito('Noticia publicada')
    await refrescar()
  } catch (fallo) {
    mostrarFallo(fallo, ['titulo', 'badge', 'desc'])
  } finally {
    publicando.value = false
  }
}

async function publicarAviso(): Promise<void> {
  publicando.value = true
  errores.value = {}
  try {
    await http.post('/admin/configuracion/avisos', {
      titulo: nuevoAviso.value.titulo.trim(),
      icon: nuevoAviso.value.icon.trim() || undefined,
      desc: nuevoAviso.value.desc.trim() || undefined,
    })
    nuevoAviso.value = { titulo: '', icon: '', desc: '' }
    ui.exito('Aviso publicado')
    await refrescar()
  } catch (fallo) {
    mostrarFallo(fallo, ['titulo', 'icon', 'desc'])
  } finally {
    publicando.value = false
  }
}

async function eliminar(tipo: 'noticias' | 'avisos', id: string, titulo: string): Promise<void> {
  if (!confirm(`¿Eliminar «${titulo}»?`)) return
  try {
    await http.delete(`/admin/configuracion/${tipo}/${id}`)
    ui.exito('Eliminado')
    await refrescar()
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

    <p v-if="cargando" class="empty-block">Cargando…</p>

    <template v-else>
      <!-- Noticias -->
      <h2 class="section-title"><span class="accent-bar" />Noticias</h2>

      <div class="form-block">
        <label class="form-label" for="n-titulo">Título</label>
        <input
          id="n-titulo"
          v-model="nuevaNoticia.titulo"
          class="form-input"
          :class="{ 'is-invalid': errores.titulo }"
          placeholder="Ej. Nueva carta de temporada"
        />
        <p v-if="errores.titulo" class="form-error">{{ errores.titulo }}</p>

        <label class="form-label" for="n-badge">Etiqueta</label>
        <input id="n-badge" v-model="nuevaNoticia.badge" class="form-input" placeholder="NOVEDAD" />

        <label class="form-label" for="n-desc">Descripción</label>
        <textarea id="n-desc" v-model="nuevaNoticia.desc" class="form-textarea" />

        <button
          type="button"
          class="btn-primary ancho"
          :disabled="publicando || !nuevaNoticia.titulo.trim()"
          @click="publicarNoticia"
        >
          Publicar noticia
        </button>
      </div>

      <ul v-if="datos && datos.noticias.length > 0" class="lista">
        <li v-for="noticia in datos.noticias" :key="noticia.id">
          <div class="info">
            <p class="titulo">
              <span v-if="noticia.badge" class="mini-tag">{{ noticia.badge }}</span>
              {{ noticia.titulo }}
            </p>
            <p class="desc">{{ noticia.desc }}</p>
            <p class="fecha">{{ fecha(noticia.publicadoEn) }}</p>
          </div>
          <button
            type="button"
            class="coupon-delete-btn"
            aria-label="Eliminar"
            @click="eliminar('noticias', noticia.id, noticia.titulo)"
          >
            🗑
          </button>
        </li>
      </ul>
      <p v-else class="empty-block">Todavía no hay noticias publicadas.</p>

      <!-- Avisos -->
      <h2 class="section-title"><span class="accent-bar" />Avisos</h2>

      <div class="form-block">
        <label class="form-label" for="a-titulo">Título</label>
        <input
          id="a-titulo"
          v-model="nuevoAviso.titulo"
          class="form-input"
          placeholder="Ej. Hoy cerramos a las 18:00"
        />

        <label class="form-label" for="a-icon">Icono</label>
        <input id="a-icon" v-model="nuevoAviso.icon" class="form-input" maxlength="8" placeholder="⚠️" />

        <label class="form-label" for="a-desc">Descripción</label>
        <textarea id="a-desc" v-model="nuevoAviso.desc" class="form-textarea" />

        <button
          type="button"
          class="btn-primary ancho"
          :disabled="publicando || !nuevoAviso.titulo.trim()"
          @click="publicarAviso"
        >
          Publicar aviso
        </button>
      </div>

      <ul v-if="datos && datos.avisos.length > 0" class="lista">
        <li v-for="aviso in datos.avisos" :key="aviso.id">
          <div class="info">
            <p class="titulo"><span class="icono">{{ aviso.icon }}</span> {{ aviso.titulo }}</p>
            <p class="desc">{{ aviso.desc }}</p>
            <p class="fecha">{{ fecha(aviso.publicadoEn) }}</p>
          </div>
          <button
            type="button"
            class="coupon-delete-btn"
            aria-label="Eliminar"
            @click="eliminar('avisos', aviso.id, aviso.titulo)"
          >
            🗑
          </button>
        </li>
      </ul>
      <p v-else class="empty-block">Todavía no hay avisos publicados.</p>
    </template>
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

.section-title {
  margin-left: 0;
  margin-right: 0;
}

.form-block {
  margin: 0 0 16px;
}

.ancho {
  width: 100%;
}

.lista {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
}

.lista li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: var(--white);
  border-radius: 14px;
  padding: 12px 14px;
  margin-bottom: 10px;
  box-shadow: var(--shadow);
}

.info {
  flex: 1;
  min-width: 0;
}

.titulo {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  color: var(--ink);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.icono {
  font-size: 16px;
}

.desc {
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.45;
  margin: 4px 0 0;
}

.fecha {
  font-size: 10.5px;
  color: var(--muted);
  margin: 6px 0 0;
  font-weight: 600;
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
</style>
