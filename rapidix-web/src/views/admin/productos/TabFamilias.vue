<script setup lang="ts">
/**
 * Productos → ventana «Familias»: en qué orden se ven las filas de la Tienda.
 *
 * No hay alta ni baja: las familias se dan de alta solas al nombrarlas en un
 * producto o en una importación. Lo único que se decide aquí es el orden, que
 * es una decisión del negocio —primero lo que trae al cliente a la tienda— y no
 * se puede deducir del nombre ni de cuántos productos tenga cada una.
 *
 * La lista se relee tras cada cambio en vez de reordenarse en memoria: así lo
 * que se ve es el orden que va a ver el cliente, empates incluidos.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import SkeletonList from '@/components/SkeletonList.vue'
import { soloNumeros } from './etiquetas'
import type { CategoriaAdmin } from '@/api/tipos'

const props = defineProps<{ activa: boolean }>()

const ui = useUiStore()

/** Valor con el que nacen las categorías: «sin priorizar», al final. */
const SIN_PRIORIZAR = 99

const familias = ref<CategoriaAdmin[]>([])
const cargando = ref(true)
const guardando = ref<string | null>(null)

const sinPriorizar = computed(
  () => familias.value.filter((f) => f.prioridad >= SIN_PRIORIZAR).length,
)

onMounted(() => void cargar())

watch(
  () => props.activa,
  (activa) => {
    if (activa) void cargar()
  },
)

async function cargar(): Promise<void> {
  cargando.value = true
  try {
    familias.value = await http.get<CategoriaAdmin[]>('/admin/categorias')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
}

/**
 * Guarda la prioridad escrita en una fila.
 *
 * Un valor fuera de rango no se manda: se devuelve el campo a lo que había. El
 * backend lo rechazaría igual, pero un 400 por escribir «0» no le dice nada a
 * quien está ordenando una lista.
 */
async function guardar(familia: CategoriaAdmin, valor: string): Promise<void> {
  const prioridad = Number(valor)
  if (!Number.isInteger(prioridad) || prioridad < 1 || prioridad > SIN_PRIORIZAR) {
    ui.error(`El orden va de 1 a ${SIN_PRIORIZAR}.`)
    await cargar()
    return
  }
  if (prioridad === familia.prioridad) return

  guardando.value = familia.id
  try {
    await http.patch(`/admin/categorias/${familia.id}/prioridad`, { prioridad })
    await cargar()
  } catch (fallo) {
    ui.errorDeApi(fallo)
    await cargar()
  } finally {
    guardando.value = null
  }
}
</script>

<template>
  <div class="ventana-familias">
    <p class="explicacion">
      El número decide en qué orden ve el cliente las filas de la Tienda: <strong>1</strong> va
      primero. Las familias que comparten número se ordenan entre ellas por nombre, y
      <strong>{{ SIN_PRIORIZAR }}</strong> es «sin priorizar»: caen al final.
    </p>
    <p v-if="!cargando && sinPriorizar > 0" class="pendientes">
      {{ sinPriorizar }} {{ sinPriorizar === 1 ? 'familia' : 'familias' }} sin priorizar.
    </p>

    <SkeletonList v-if="cargando" :cantidad="4" />

    <template v-else-if="familias.length > 0">
      <article v-for="familia in familias" :key="familia.id" class="fila-familia">
        <input
          class="orden"
          type="number"
          min="1"
          :max="SIN_PRIORIZAR"
          :value="familia.prioridad"
          :disabled="guardando === familia.id"
          :aria-label="`Orden de ${familia.nombre}`"
          @keydown="soloNumeros"
          @change="guardar(familia, ($event.target as HTMLInputElement).value)"
        />

        <div class="info">
          <p class="nombre">{{ familia.nombre }}</p>
          <p class="cuantos">
            {{ familia.totalProductos }}
            {{ familia.totalProductos === 1 ? 'producto' : 'productos' }}
            <span v-if="familia.totalProductos === 0"> · no aparece en la Tienda</span>
          </p>
        </div>
      </article>
    </template>

    <p v-else class="empty-block">
      Todavía no hay familias. Se crean solas al dar de alta un producto.
    </p>
  </div>
</template>

<style scoped>
.explicacion {
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.5;
  margin: 0 0 10px;
}

.explicacion strong {
  color: var(--ink);
  font-weight: 700;
}

.pendientes {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11.5px;
  color: var(--terracotta-dark);
  margin: 0 0 12px;
}

.fila-familia {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--white);
  border-radius: 14px;
  padding: 10px 12px;
  margin-bottom: 10px;
  box-shadow: var(--shadow);
}

.orden {
  width: 52px;
  flex-shrink: 0;
  border: 1.5px solid var(--line);
  border-radius: 10px;
  background: var(--cream);
  text-align: center;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 15px;
  color: var(--ink);
  padding: 8px 4px;
  outline: none;
}

.orden:focus {
  border-color: var(--gold-dark);
}

.orden:disabled {
  opacity: 0.5;
}

.info {
  flex: 1;
  min-width: 0;
}

.nombre {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  color: var(--ink);
  margin: 0;
}

.cuantos {
  font-size: 11px;
  color: var(--muted);
  margin: 2px 0 0;
}
</style>
