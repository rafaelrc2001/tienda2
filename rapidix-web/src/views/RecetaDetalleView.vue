<script setup lang="ts">
/**
 * Detalle de una receta (Word 4.4 y 6.4).
 *
 * Aquí es donde se maneja el **bloqueo por inactividad**: si `GET /recetas/:id`
 * responde 423 con `RECETARIO_BLOQUEADO`, se muestra la pantalla de bloqueo
 * con el cupón INACTIVITY que la API acaba de emitir — no un toast de error.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ErrorApi, http, type CuponDeBloqueo } from '@/api/http'
import { useRecetarioStore } from '@/stores/recetario'
import { useUiStore } from '@/stores/ui'
import { fecha } from '@/utils/formato'
import RecetaEditor from '@/components/RecetaEditor.vue'
import type { GuardarReceta, RecetaDetalle } from '@/api/tipos'

const route = useRoute()
const recetario = useRecetarioStore()
const ui = useUiStore()

const receta = ref<RecetaDetalle | null>(null)
const cargando = ref(true)
const bloqueo = ref<{ mensaje: string; cupon: CuponDeBloqueo | null } | null>(null)
const noEncontrada = ref(false)

const editorAbierto = ref(false)
const guardando = ref(false)
const editor = ref<InstanceType<typeof RecetaEditor> | null>(null)

const ocupado = ref('')
const calificacion = ref(0)

const id = computed(() => String(route.params.id))

/** `youtu.be/ID`, `watch?v=ID` o el propio ID: todo acaba en un `embed`. */
const urlEmbed = computed(() => {
  const bruto = receta.value?.youtube?.trim()
  if (!bruto) return null
  const patron = /(?:youtu\.be\/|v=|embed\/)([\w-]{11})/.exec(bruto)
  const idVideo = patron?.[1] ?? (/^[\w-]{11}$/.test(bruto) ? bruto : null)
  return idVideo ? `https://www.youtube-nocookie.com/embed/${idVideo}` : null
})

const estaPausada = computed(() => recetario.pausada?.recetaId === id.value)

onMounted(cargar)
watch(id, cargar)

async function cargar(): Promise<void> {
  cargando.value = true
  bloqueo.value = null
  noEncontrada.value = false
  try {
    receta.value = await http.get<RecetaDetalle>(`/recetas/${id.value}`)
    calificacion.value = receta.value.miCalificacion ?? 0
    // La pausa se necesita para saber si esta receta es la pausada.
    await recetario.cargarPausada().catch(() => {})
  } catch (fallo) {
    if (fallo instanceof ErrorApi && fallo.codigo === 'RECETARIO_BLOQUEADO') {
      bloqueo.value = { mensaje: fallo.message, cupon: fallo.cuponDeBloqueo }
    } else if (fallo instanceof ErrorApi && fallo.estado === 404) {
      noEncontrada.value = true
    } else {
      ui.errorDeApi(fallo)
    }
  } finally {
    cargando.value = false
  }
}

/** Envuelve una acción sobre la receta y repinta con lo que devuelve la API. */
async function accion(clave: string, ejecutar: () => Promise<void>): Promise<void> {
  ocupado.value = clave
  try {
    await ejecutar()
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    ocupado.value = ''
  }
}

const alternarGuardada = (): Promise<void> =>
  accion('guardar', async () => {
    if (!receta.value) return
    if (receta.value.guardada) {
      await http.delete(`/recetas/${id.value}/guardar`)
      receta.value.guardada = false
      ui.info('Quitada de Mis Recetas')
    } else {
      await http.post(`/recetas/${id.value}/guardar`)
      receta.value.guardada = true
      ui.exito('Guardada en Mis Recetas')
    }
  })

/** Pausar otra receta sustituye a la anterior: nunca coexisten dos. */
const alternarPausa = (): Promise<void> =>
  accion('pausar', async () => {
    if (estaPausada.value) {
      await recetario.quitarPausa()
      ui.info('Receta quitada de la pausa')
    } else {
      await recetario.pausar(id.value)
      ui.exito('Receta en pausa. La verás en tu inicio.')
    }
  })

const marcarCocinada = (): Promise<void> =>
  accion('cocinada', async () => {
    await http.post(`/recetas/${id.value}/cocinada`)
    if (receta.value) receta.value.puedeCalificar = true
    ui.exito('¡Buen provecho! Ya puedes calificarla.')
  })

const calificar = (puntuacion: number): Promise<void> =>
  accion('calificar', async () => {
    await http.post(`/recetas/${id.value}/calificar`, { puntuacion })
    calificacion.value = puntuacion
    if (receta.value) receta.value.miCalificacion = puntuacion
    ui.exito('Gracias por tu calificación')
  })

async function guardarEdicion(datos: GuardarReceta): Promise<void> {
  guardando.value = true
  try {
    receta.value = await http.patch<RecetaDetalle>(`/recetas/${id.value}`, datos)
    editorAbierto.value = false
    ui.exito('Receta actualizada')
  } catch (fallo) {
    editor.value?.mostrarErrores(fallo)
  } finally {
    guardando.value = false
  }
}

const alternarCompartir = (): Promise<void> =>
  accion('compartir', async () => {
    if (!receta.value) return
    receta.value = await http.patch<RecetaDetalle>(`/recetas/${id.value}/compartir`, {
      compartir: !receta.value.compartir,
    })
    ui.exito(
      receta.value.compartir ? 'Tu receta ya aparece en Comunidad' : 'Tu receta dejó de compartirse',
    )
  })

async function copiarCupon(codigo: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(codigo)
    ui.exito('Código copiado')
  } catch {
    ui.error('No pudimos copiar el código. Cópialo a mano.')
  }
}
</script>

<template>
  <div class="detalle">
    <RouterLink to="/recetario" class="admin-back-inline">← Volver al Recetario</RouterLink>

    <div v-if="cargando" class="empty-block">Cargando receta…</div>

    <!--
      Recetario bloqueado por inactividad. La lista se sigue viendo; lo que
      se bloquea es abrir una receta.
    -->
    <div v-else-if="bloqueo" class="recetario-locked-block">
      <div class="ico">🔒</div>
      <p class="t">Recetario bloqueado</p>
      <p class="s">{{ bloqueo.mensaje }}</p>

      <div v-if="bloqueo.cupon" class="client-cupon-card">
        <p class="client-cupon-title">{{ bloqueo.cupon.titulo }}</p>
        <p class="client-cupon-meta">{{ bloqueo.cupon.mensaje }}</p>
        <div class="client-cupon-code-row">
          <span class="coupon-code-badge">{{ bloqueo.cupon.code }}</span>
          <button type="button" class="btn-secondary" @click="copiarCupon(bloqueo.cupon.code)">
            Copiar
          </button>
        </div>
        <p class="client-cupon-vence">Vence el {{ fecha(bloqueo.cupon.expiresAt) }}</p>
      </div>

      <RouterLink to="/tienda" class="btn-primary ancho">Hacer un pedido</RouterLink>
    </div>

    <p v-else-if="noEncontrada" class="empty-block">Esta receta ya no existe.</p>

    <template v-else-if="receta">
      <div class="detalle-portada">
        <img v-if="receta.imagenUrl" :src="receta.imagenUrl" :alt="receta.nombre" />
        <span v-else class="portada-emoji">{{ receta.emoji ?? '🍲' }}</span>
      </div>

      <h2 class="detalle-nombre">{{ receta.nombre }}</h2>
      <p class="detalle-meta">
        <span v-if="receta.tiempo">⏱ {{ receta.tiempo }}</span>
        <span v-if="receta.porciones">🍽 {{ receta.porciones }} porciones</span>
        <span v-if="receta.calificacionPromedio !== null">
          ⭐ {{ receta.calificacionPromedio.toFixed(1) }} ({{ receta.totalCalificaciones }})
        </span>
      </p>
      <div class="recipe-cats">
        <span v-for="cat in receta.categorias" :key="cat" class="mini-tag">{{ cat }}</span>
        <span v-if="!receta.esPropia" class="mini-tag author">{{ receta.autorNombre }}</span>
      </div>

      <div class="acciones">
        <button
          type="button"
          class="btn-secondary"
          :disabled="ocupado === 'guardar'"
          @click="alternarGuardada"
        >
          {{ receta.guardada ? '★ Guardada' : '☆ Guardar' }}
        </button>
        <button
          type="button"
          class="btn-secondary"
          :disabled="ocupado === 'pausar'"
          @click="alternarPausa"
        >
          {{ estaPausada ? '▶ Continuar' : '⏸ Pausar' }}
        </button>
        <button
          v-if="receta.esPropia"
          type="button"
          class="btn-secondary"
          @click="editorAbierto = true"
        >
          ✏️ Editar
        </button>
      </div>

      <div v-if="urlEmbed" class="video-wrap">
        <iframe
          :src="urlEmbed"
          title="Vídeo de la receta"
          allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
          allowfullscreen
        />
      </div>

      <h3 class="section-title"><span class="accent-bar" />Ingredientes</h3>
      <ul v-if="receta.ingredientes.length > 0" class="lista-ingredientes">
        <li v-for="(ing, i) in receta.ingredientes" :key="i">
          <strong>{{ ing.nombre }}</strong>
          <span v-if="ing.cantidad"> · {{ ing.cantidad }}</span>
        </li>
      </ul>
      <p v-else class="empty-block">Esta receta no tiene ingredientes registrados.</p>

      <h3 class="section-title"><span class="accent-bar" />Preparación</h3>
      <ol v-if="receta.pasos.length > 0" class="lista-pasos">
        <li v-for="(paso, i) in receta.pasos" :key="i">{{ paso }}</li>
      </ol>
      <p v-else class="empty-block">Esta receta no tiene pasos registrados.</p>

      <!-- Switch de comunidad: solo en recetas propias. -->
      <div v-if="receta.esPropia" class="toggle-row compartir">
        <div>
          <p class="t-lbl">Compartir con la comunidad</p>
          <p class="t-sub">Otros clientes podrán verla en la pestaña Comunidad.</p>
        </div>
        <label class="switch">
          <input
            type="checkbox"
            :checked="receta.compartir"
            :disabled="ocupado === 'compartir'"
            @change="alternarCompartir"
          />
          <span class="slider-switch" />
        </label>
      </div>

      <div class="cierre">
        <button
          type="button"
          class="btn-primary ancho"
          :disabled="ocupado === 'cocinada'"
          @click="marcarCocinada"
        >
          ¡Listo a comer!
        </button>

        <div v-if="receta.puedeCalificar" class="calificar">
          <p class="calificar-label">¿Qué te pareció?</p>
          <div class="estrellas">
            <button
              v-for="n in 5"
              :key="n"
              type="button"
              class="estrella"
              :class="{ activa: n <= calificacion }"
              :disabled="ocupado === 'calificar'"
              :aria-label="`${n} estrellas`"
              @click="calificar(n)"
            >
              ★
            </button>
          </div>
        </div>
      </div>

      <RecetaEditor
        v-if="editorAbierto"
        ref="editor"
        :receta="receta"
        :guardando="guardando"
        @guardar="guardarEdicion"
        @cerrar="editorAbierto = false"
      />
    </template>
  </div>
</template>

<style scoped>
.detalle {
  padding: 12px 18px 24px;
}

.admin-back-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  cursor: pointer;
  padding: 0 0 14px;
  text-decoration: none;
}

.detalle-portada {
  height: 180px;
  border-radius: 18px;
  background: var(--cream-2);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-shadow: var(--shadow);
  margin-bottom: 14px;
}

.detalle-portada img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.portada-emoji {
  font-size: 72px;
}

.detalle-nombre {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 18px;
  color: var(--ink);
  margin: 0 0 6px;
  line-height: 1.25;
}

.detalle-meta {
  font-size: 12px;
  color: var(--muted);
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin: 0 0 8px;
}

.recipe-cats {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.acciones {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.video-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--shadow);
  margin-bottom: 8px;
  background: var(--ink);
}

.video-wrap iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}

.section-title {
  margin-left: 0;
  margin-right: 0;
}

.lista-ingredientes,
.lista-pasos {
  margin: 0 0 8px;
  padding-left: 20px;
  font-size: 13px;
  color: var(--ink);
  line-height: 1.6;
}

.lista-ingredientes {
  list-style: disc;
}

.lista-pasos li {
  margin-bottom: 8px;
}

.compartir {
  margin-top: 16px;
}

.cierre {
  margin-top: 18px;
}

.ancho {
  width: 100%;
  display: block;
  text-decoration: none;
}

.calificar {
  margin-top: 16px;
  text-align: center;
}

.calificar-label {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  color: var(--ink);
  margin: 0 0 6px;
}

.estrellas {
  display: flex;
  justify-content: center;
  gap: 6px;
}

.estrella {
  background: none;
  border: none;
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
  color: var(--line);
  padding: 0;
}

.estrella.activa {
  color: var(--gold);
}

/* ---- Bloqueo por inactividad ---- */

.recetario-locked-block {
  text-align: center;
  padding: 40px 8px 30px;
}

.recetario-locked-block .ico {
  font-size: 46px;
  margin-bottom: 16px;
}

.recetario-locked-block .t {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 15.5px;
  color: var(--ink);
  margin: 0 0 10px;
}

.recetario-locked-block .s {
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.6;
  margin: 0 0 22px;
}

.client-cupon-card {
  background: linear-gradient(135deg, #fff3e0, #ffe0b2);
  border: 1.5px dashed var(--gold-dark);
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 18px;
  text-align: left;
}

.client-cupon-title {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13.5px;
  color: var(--ink);
  margin: 0 0 4px;
}

.client-cupon-meta {
  font-size: 11.5px;
  color: var(--muted);
  margin: 0 0 12px;
  line-height: 1.5;
}

.client-cupon-code-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: var(--white);
  border-radius: 11px;
  padding: 10px 12px;
}

.coupon-code-badge {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  color: var(--terracotta-dark);
  background: var(--cream-2);
  padding: 4px 10px;
  border-radius: 8px;
  letter-spacing: 0.03em;
}

.client-cupon-vence {
  font-size: 10.5px;
  color: var(--muted);
  font-weight: 600;
  margin: 10px 0 0;
}
</style>
