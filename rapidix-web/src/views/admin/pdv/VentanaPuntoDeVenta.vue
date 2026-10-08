<script setup lang="ts">
/**
 * PDV → Punto de Venta: el turno del cajero.
 *
 * Sin turno abierto solo hay «Crear turno», que es la lógica de crear un
 * reparto en Rutas: dentro de él se capturan los pedidos, que ahí mismo se
 * entregan y se cobran, y se cierra con su corte de caja. Con turno, solo la
 * caja: la tabla de los pedidos del turno está en la pestaña Corte de caja.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { fechaHora } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import CajaPdv from './CajaPdv.vue'
import type { Tienda, TurnoPdv } from '@/api/tipos'

/** La tienda desde la que se mira el PDV: el turno es el de esta tienda. */
const props = defineProps<{ tienda: Tienda }>()

const ui = useUiStore()

const turno = ref<TurnoPdv | null>(null)
const cargando = ref(true)
const error = ref('')
const creando = ref(false)

onMounted(cargar)

async function cargar(): Promise<void> {
  error.value = ''
  try {
    turno.value = await http.get<TurnoPdv | null>(
      `/admin/pdv/turnos/abierto?tiendaId=${props.tienda.id}`,
    )
  } catch (fallo) {
    error.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos cargar el turno.'
  } finally {
    cargando.value = false
  }
}

async function crearTurno(): Promise<void> {
  creando.value = true
  try {
    turno.value = await http.post<TurnoPdv>('/admin/pdv/turnos', {
      tiendaId: props.tienda.id,
    })
    ui.exito(`Turno ${turno.value.folio} abierto`)
  } catch (fallo) {
    ui.errorDeApi(fallo)
    // Si ya tenía uno abierto en otra pestaña, se enseña ese.
    await cargar()
  } finally {
    creando.value = false
  }
}
</script>

<template>
  <div class="ventana-pdv">
    <SkeletonList v-if="cargando" :cantidad="3" />

    <p v-else-if="error" class="form-error">{{ error }}</p>

    <template v-else-if="!turno">
      <p class="sin-turno">No tienes un turno abierto en {{ tienda.nombre }}.</p>
      <button type="button" class="btn-crear" :disabled="creando" @click="crearTurno">
        {{ creando ? 'Creando…' : '+ Crear Turno' }}
      </button>
    </template>

    <template v-else>
      <p class="turno-abierto">
        <strong>{{ turno.folio }}</strong> · {{ turno.tienda.nombre }} · {{ turno.cajero }} ·
        abierto
        {{ fechaHora(turno.abiertoEn) }}
      </p>

      <CajaPdv :turno="turno" />
    </template>
  </div>
</template>

<style scoped>
.sin-turno {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 10px;
}

.btn-crear {
  width: 100%;
  height: 48px;
  border: none;
  border-radius: 12px;
  background: var(--sage);
  color: var(--white);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13.5px;
  cursor: pointer;
}

.btn-crear:disabled {
  opacity: 0.6;
}

.turno-abierto {
  font-size: 11.5px;
  color: var(--muted);
  margin: 0 0 10px;
}

.turno-abierto strong {
  font-family: var(--font-heading);
  color: var(--ink);
}
</style>
