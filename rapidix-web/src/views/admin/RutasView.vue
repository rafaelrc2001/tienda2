<script setup lang="ts">
/**
 * Administración → Rutas: la pantalla del repartidor.
 *
 * Todo cuelga de su jornada, así que la API la manda junto con las entregas y
 * aquí se pinta arriba, fija: mientras no la haya iniciado no se pueden crear
 * entregas, y el botón lo dice en vez de esperar al 409.
 *
 * Los pedidos ya no se listan aquí: se agregan, se cargan y se entregan desde
 * dentro de cada entrega, que es la que dice con quién sale el camión.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { fechaNumerica } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import { nombreEntrega } from './rutas/etiquetas'
import type { EntregaRuta, FiltroRutas, Jornada, TableroRutas } from '@/api/tipos'

const ui = useUiStore()
const router = useRouter()

/** El tablero pide un filtro de pedidos; aquí solo se usan la jornada y las entregas. */
const FILTRO: FiltroRutas = 'disponibles'

const jornada = ref<Jornada | null>(null)
const entregas = ref<EntregaRuta[]>([])
const cargando = ref(true)

/** La hoja de «Crear entrega». */
const creandoEntrega = ref(false)
const nombreNueva = ref('')
const enviandoEntrega = ref(false)

/** Una recarga automática puede cruzarse con otra: gana la última. */
let peticion = 0

const trabajando = computed(() => jornada.value !== null && jornada.value.finalizadaEn === null)

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
      query: { filtro: FILTRO },
    })
    if (numero !== peticion) return
    jornada.value = respuesta.jornada
    entregas.value = respuesta.entregas
  } catch (fallo) {
    if (numero === peticion && !silenciosa) ui.errorDeApi(fallo)
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
// La jornada
// ------------------------------------------------------------------

/** «Inicio de entregas», que también reanuda la que se había finalizado. */
async function abrirJornada(): Promise<void> {
  try {
    jornada.value = await http.post<Jornada>('/admin/rutas/jornada')
    ui.exito('Jornada iniciada. Ya puedes crear tus entregas.')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  }
  await cargar(false)
}

// ------------------------------------------------------------------
// Las entregas
// ------------------------------------------------------------------

function abrirCrearEntrega(): void {
  nombreNueva.value = ''
  creandoEntrega.value = true
}

/** «Crear entrega» y directo a ella: lo siguiente siempre es agregarle pedidos. */
async function crearEntrega(): Promise<void> {
  if (enviandoEntrega.value) return
  enviandoEntrega.value = true
  try {
    const creada = await http.post<EntregaRuta>('/admin/rutas/entregas', {
      ...(nombreNueva.value.trim() ? { nombre: nombreNueva.value.trim() } : {}),
    })
    creandoEntrega.value = false
    ui.exito(`${nombreEntrega(creada)} creada. Agrégale sus pedidos.`)
    await router.push(`/admin/rutas/entregas/${creada.id}`)
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    enviandoEntrega.value = false
  }
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <!-- La jornada manda sobre todo lo demás, así que va arriba y siempre. -->
    <section class="jornada" :class="{ activa: trabajando }">
      <div class="estado">
        <p class="t">
          <template v-if="trabajando">🛵 Jornada abierta</template>
          <template v-else-if="jornada">⏸️ Entregas finalizadas</template>
          <template v-else>🅿️ Sin jornada</template>
        </p>
        <p class="s">
          <template v-if="jornada">
            Desde {{ fechaNumerica(jornada.iniciadaEn) }} · {{ jornada.piezasEnCamion }} pieza(s) en
            el camión
          </template>
          <template v-else> Pulsa «Inicio de entregas» antes de cargar el camión. </template>
        </p>
      </div>

      <div class="acciones">
        <button v-if="!trabajando" type="button" class="btn-primary" @click="abrirJornada">
          {{ jornada ? 'Reanudar entregas' : 'Inicio de entregas' }}
        </button>
        <!-- Finalizar y hacer el corte son de cada entrega: están dentro de ella. -->
        <button v-else type="button" class="btn-primary" @click="abrirCrearEntrega">
          + Crear entrega
        </button>
      </div>
    </section>

    <SkeletonList v-if="cargando" :cantidad="3" />

    <!-- Las entregas de la jornada: cada una es un viaje con sus pedidos. -->
    <section v-else-if="entregas.length > 0" class="entregas">
      <p class="entregas-titulo">Mis entregas</p>
      <div class="tabla-envoltorio">
        <table class="tabla lineal">
          <thead>
            <tr>
              <th>Entrega</th>
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
                <span class="sub">{{ fechaNumerica(entrega.creadoEn) }}</span>
              </td>
              <td class="num">{{ entrega.pedidos }}</td>
              <td class="num">{{ entrega.recolectados }}</td>
              <td class="num">{{ entrega.enRuta }}</td>
              <td class="num">{{ entrega.entregados }}</td>
              <td>
                <span class="mini-tag" :class="{ viva: !entrega.cortada && !entrega.finalizadaEn }">
                  {{
                    entrega.cortada ? 'Cortada' : entrega.finalizadaEn ? 'Finalizada' : 'Abierta'
                  }}
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

    <p v-else-if="trabajando" class="empty-block">
      Aún no tienes entregas: créala y agrégale sus pedidos.
    </p>

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
            Crear y agregar pedidos
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pantalla {
  padding: 12px 18px 0;
}

.admin-back-inline {
  display: inline-block;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  padding: 0 0 8px;
  text-decoration: none;
}

/* La jornada: lo primero que se mira al abrir la pantalla. */
.jornada {
  background: var(--white);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
  border-left: 4px solid var(--line);
  padding: 12px 14px;
  margin-bottom: 12px;
}

.jornada.activa {
  border-left-color: var(--verde);
}

.jornada .t {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13.5px;
  color: var(--ink);
}

.jornada .s {
  margin: 3px 0 0;
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.4;
}

.jornada .acciones {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.jornada .acciones button {
  flex: 1;
  padding: 9px 8px;
  font-size: 12px;
}

.tabla {
  min-width: 820px;
}

.entregas-titulo {
  margin: 0 0 6px;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  color: var(--ink);
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

.modal-texto {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.45;
}
</style>
