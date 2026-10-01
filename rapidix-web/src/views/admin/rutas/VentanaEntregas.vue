<script setup lang="ts">
/**
 * Rutas → Entregas: las entregas abiertas de la jornada y «Crear entrega».
 *
 * Solo las que están sin iniciar o en curso. La finalizada pasa a Liquidación y
 * la que ya tiene corte a Historial: cada entrega aparece en una sola pestaña.
 *
 * La jornada no se pinta ni se inicia aquí: la API la abre sola con la primera
 * entrega del día y la cierra el corte de la última. Crear una entrega no la
 * arranca: todo lo demás (iniciarla, pedidos, camión, finalizar) va dentro de
 * cada entrega, y su corte en la pestaña Liquidación.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { fechaDia } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import { nombreEntrega } from './etiquetas'
import type { EntregaRuta, FiltroRutas, TableroRutas } from '@/api/tipos'

const ui = useUiStore()
const router = useRouter()

/** El tablero pide un filtro de pedidos; aquí solo se usan las entregas. */
const FILTRO: FiltroRutas = 'disponibles'

const entregas = ref<EntregaRuta[]>([])
const cargando = ref(true)
const error = ref('')

/** La hoja de «Crear entrega». */
const creandoEntrega = ref(false)
const nombreNueva = ref('')
const enviandoEntrega = ref(false)

/** Una recarga automática puede cruzarse con otra: gana la última. */
let peticion = 0

/**
 * `silenciosa` es la recarga automática: sin esqueleto y sin avisar si falla.
 * En la calle la señal va y viene, y un error cada minuto por algo que nadie
 * pidió solo estorba; la siguiente vuelta lo vuelve a intentar.
 */
async function cargar(conEsqueleto = true, silenciosa = false): Promise<void> {
  const numero = ++peticion
  if (conEsqueleto) cargando.value = true
  try {
    const respuesta = await http.get<TableroRutas>('/admin/rutas', {
      query: { filtro: FILTRO, limite: 1 },
    })
    if (numero !== peticion) return
    entregas.value = respuesta.entregas.filter((e) => !e.cortada && e.finalizadaEn === null)
    error.value = ''
  } catch {
    if (numero === peticion && !silenciosa) error.value = 'No pudimos cargar tus entregas.'
  } finally {
    if (numero === peticion) cargando.value = false
  }
}

// ------------------------------------------------------------------
// Recarga sola
// ------------------------------------------------------------------

/** Cada cuánto se relee el tablero mientras la pantalla está a la vista. */
const CADA_MS = 60_000

/**
 * Los contadores de cada entrega cambian mientras el repartidor está en la
 * calle: se relee al volver a la pestaña y cada minuto, solo con la pantalla
 * visible.
 */
function recargarSola(): void {
  if (document.visibilityState !== 'visible') return
  void cargar(false, true)
}

let reloj: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  void cargar()
  reloj = setInterval(recargarSola, CADA_MS)
  document.addEventListener('visibilitychange', recargarSola)
})

onBeforeUnmount(() => {
  clearInterval(reloj)
  document.removeEventListener('visibilitychange', recargarSola)
})

// ------------------------------------------------------------------
// Las entregas
// ------------------------------------------------------------------

function abrirCrearEntrega(): void {
  nombreNueva.value = ''
  creandoEntrega.value = true
}

/** Cada entrega se inicia dentro de ella: recién creada queda «Sin iniciar». */
function estadoEntrega(entrega: EntregaRuta): string {
  return entrega.iniciadaEn ? 'En curso' : 'Sin iniciar'
}

/** «Crear entrega» y directo a ella, donde está su «Iniciar entrega». */
async function crearEntrega(): Promise<void> {
  if (enviandoEntrega.value) return
  enviandoEntrega.value = true
  try {
    const creada = await http.post<EntregaRuta>('/admin/rutas/entregas', {
      ...(nombreNueva.value.trim() ? { nombre: nombreNueva.value.trim() } : {}),
    })
    creandoEntrega.value = false
    ui.exito(`${nombreEntrega(creada)} creada. Iníciala cuando vayas a cargarla.`)
    await router.push(`/admin/rutas/entregas/${creada.id}`)
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    enviandoEntrega.value = false
  }
}
</script>

<template>
  <div>
    <button type="button" class="btn-primary crear" @click="abrirCrearEntrega">
      + Crear entrega
    </button>

    <SkeletonList v-if="cargando" :cantidad="3" />

    <p v-else-if="error" class="error-bloque">
      {{ error }}
      <button type="button" class="enlace" @click="cargar()">Reintentar</button>
    </p>

    <!-- Las entregas abiertas de la jornada: cada una es un viaje con sus pedidos. -->
    <section v-else-if="entregas.length > 0">
      <p class="seccion-titulo">Mis entregas</p>
      <div class="tabla-envoltorio">
        <table class="tabla lineal dos-fijas">
          <thead>
            <tr>
              <th>Entrega</th>
              <th>Fecha</th>
              <th class="num">Pedidos</th>
              <th class="num">Recolectados</th>
              <th class="num">En ruta</th>
              <th class="num">Entregados</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entrega in entregas" :key="entrega.id">
              <td>
                <span class="folio">{{ nombreEntrega(entrega) }}</span>
              </td>
              <td>{{ fechaDia(entrega.creadoEn) }}</td>
              <td class="num">{{ entrega.pedidos }}</td>
              <td class="num">{{ entrega.recolectados }}</td>
              <td class="num">{{ entrega.enRuta }}</td>
              <td class="num">{{ entrega.entregados }}</td>
              <td>
                <span class="mini-tag" :class="{ viva: estadoEntrega(entrega) === 'En curso' }">
                  {{ estadoEntrega(entrega) }}
                </span>
              </td>
              <td class="accion">
                <RouterLink :to="`/admin/rutas/entregas/${entrega.id}`" class="btn-secondary abrir">
                  Abrir →
                </RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <p v-else class="empty-block">No tienes entregas abiertas: crea una y agrégale sus pedidos.</p>

    <!-- «Crear entrega»: el número lo pone la API; el nombre ayuda a reconocerla. -->
    <div v-if="creandoEntrega" class="modal-overlay" @click.self="creandoEntrega = false">
      <div class="modal-sheet" role="dialog" aria-label="Crear entrega">
        <div class="modal-handle" />
        <p class="modal-title">Crear entrega</p>
        <p class="modal-texto">
          Se numera sola. Si quieres, ponle un nombre para reconocerla: la zona o la colonia.
        </p>
        <input
          v-model="nombreNueva"
          class="form-input"
          maxlength="80"
          placeholder="Nombre (opcional), p. ej. Centro"
          @keyup.enter="crearEntrega"
        />
        <div class="modal-actions">
          <button type="button" class="btn-cancel" @click="creandoEntrega = false">Volver</button>
          <button
            type="button"
            class="btn-primary"
            :disabled="enviandoEntrega"
            @click="crearEntrega"
          >
            Crear entrega
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.crear {
  display: block;
  width: 100%;
  margin-bottom: 12px;
  padding: 9px 8px;
  font-size: 12px;
}

.tabla {
  min-width: 820px;
}

.tabla.lineal .abrir {
  display: inline-block;
  padding: 4px 12px;
  font-size: 12px;
  text-decoration: none;
  box-shadow: none;
}

.mini-tag.viva {
  background: color-mix(in srgb, var(--verde) 15%, var(--white));
  color: var(--verde-compra);
}

/* El vacío global trae 30px por arriba: aquí va pegado a la lista. */
.empty-block {
  margin: 0;
  padding: 12px 0;
}

.modal-texto {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.45;
}
</style>
