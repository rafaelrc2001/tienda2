<script setup lang="ts">
/**
 * Una fila del catálogo: los productos de una familia (HU-06).
 *
 * Flechas, puntos de posición y la tarjeta del centro agrandada. Cuando todo
 * cabe sin desplazar —una familia de dos productos en una pantalla ancha—, las
 * flechas siguen funcionando pero solo mueven cuál es la tarjeta activa: no
 * tiene sentido intentar desplazar algo que ya se ve entero.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import TarjetaProducto from './TarjetaProducto.vue'
import type { FamiliaRecomendada } from '@/api/tipos'

const props = defineProps<{
  familia: FamiliaRecomendada
  controlInventario: boolean
}>()

const emit = defineEmits<{
  (e: 'programar', productoId: string, nombre: string): void
  /** El cliente tocó el carrusel: el bloque de repetir compra se pliega. */
  (e: 'interaccion'): void
}>()

const pista = ref<HTMLElement | null>(null)
const activo = ref(0)
/** Todo cabe sin desplazar: las flechas solo cambian la tarjeta activa. */
const cabeEntero = ref(false)

const total = computed(() => props.familia.productos.length)
/** Con muchas tarjetas los puntos dejan de leerse y se pasa a un contador. */
const mostrarPuntos = computed(() => total.value > 1 && total.value <= 10)

let observador: ResizeObserver | null = null

function medir(): void {
  const el = pista.value
  if (!el) return
  cabeEntero.value = el.scrollWidth <= el.clientWidth + 1
}

/** Centra la tarjeta `indice` dentro de la pista. */
function centrar(indice: number, comportamiento: ScrollBehavior = 'smooth'): void {
  const el = pista.value
  const tarjeta = el?.children[indice] as HTMLElement | undefined
  if (!el || !tarjeta || cabeEntero.value) return
  el.scrollTo({
    left: tarjeta.offsetLeft - (el.clientWidth - tarjeta.clientWidth) / 2,
    behavior: comportamiento,
  })
}

function irA(indice: number): void {
  activo.value = Math.max(0, Math.min(indice, total.value - 1))
  centrar(activo.value)
}

function mover(paso: number): void {
  emit('interaccion')
  irA(activo.value + paso)
}

/** Al desplazar con el dedo, la activa es la que quede más cerca del centro. */
function alDesplazar(): void {
  const el = pista.value
  if (!el || cabeEntero.value) return

  const centro = el.scrollLeft + el.clientWidth / 2
  let mejor = 0
  let distancia = Number.POSITIVE_INFINITY

  Array.from(el.children).forEach((hijo, indice) => {
    const tarjeta = hijo as HTMLElement
    const suCentro = tarjeta.offsetLeft + tarjeta.clientWidth / 2
    const suDistancia = Math.abs(suCentro - centro)
    if (suDistancia < distancia) {
      distancia = suDistancia
      mejor = indice
    }
  })

  activo.value = mejor
}

onMounted(async () => {
  await nextTick()
  medir()

  // HU-03: la fila arranca en lo que ya compró, no en el primero de la lista.
  const yaComprado = props.familia.productos.findIndex((p) => p.ultimoComprado)
  if (yaComprado > 0) {
    activo.value = yaComprado
    centrar(yaComprado, 'auto')
  }

  if (typeof ResizeObserver !== 'undefined' && pista.value) {
    observador = new ResizeObserver(() => medir())
    observador.observe(pista.value)
  }
})

onBeforeUnmount(() => observador?.disconnect())
</script>

<template>
  <section class="familia">
    <header class="cabecera">
      <h2 class="titulo"><span class="accent-bar" />{{ familia.categoria }}</h2>
    </header>

    <div class="carrusel">
      <div
        ref="pista"
        class="pista"
        :class="{ centrada: cabeEntero }"
        @scroll.passive="alDesplazar"
        @pointerdown="emit('interaccion')"
      >
        <TarjetaProducto
          v-for="(producto, indice) in familia.productos"
          :key="producto.id"
          :producto="producto"
          :activa="indice === activo"
          :control-inventario="controlInventario"
          @programar="emit('programar', producto.id, producto.nombre)"
        />
      </div>

      <!-- Las flechas van a los lados de las tarjetas, no en la cabecera. -->
      <template v-if="total > 1">
        <button
          type="button"
          class="flecha izquierda"
          aria-label="Anterior"
          :disabled="activo === 0"
          @click="mover(-1)"
        >
          ‹
        </button>
        <button
          type="button"
          class="flecha derecha"
          aria-label="Siguiente"
          :disabled="activo >= total - 1"
          @click="mover(1)"
        >
          ›
        </button>
      </template>
    </div>

    <div v-if="mostrarPuntos" class="puntos">
      <button
        v-for="(producto, indice) in familia.productos"
        :key="producto.id"
        type="button"
        class="punto"
        :class="{ activo: indice === activo }"
        :aria-label="`Ir a ${producto.nombre}`"
        @click="irA(indice)"
      />
    </div>
    <p v-else-if="total > 1" class="contador">{{ activo + 1 }} / {{ total }}</p>
  </section>
</template>

<style scoped>
.familia {
  margin-bottom: 0;
}

.cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-right: 18px;
}

.titulo {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13.5px;
  color: var(--ink);
  margin: 8px 0 2px 18px;
  display: flex;
  align-items: center;
  gap: 7px;
}

.carrusel {
  position: relative;
}

/* Flotan sobre las tarjetas vecinas, centradas en vertical respecto a la pista. */
.flecha {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1.5px solid var(--line);
  background: var(--white);
  color: var(--sage);
  box-shadow: var(--shadow);
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  padding: 0 0 2px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.flecha.izquierda {
  left: 8px;
}

.flecha.derecha {
  right: 8px;
}

/*
 * En los extremos se esconde en lugar de atenuarse: al estar encima de las
 * tarjetas, un botón apagado solo estorbaría.
 */
.flecha:disabled {
  opacity: 0;
  pointer-events: none;
}

.pista {
  position: relative;
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  /*
   * El colchón lateral es la mitad de la columna: sin él, la primera y la
   * última tarjeta no pueden llegar nunca al centro.
   */
  padding: 2px calc(50% - 94px) 6px;
  scrollbar-width: none;
}

.pista::-webkit-scrollbar {
  display: none;
}

/* Si cabe entero no hay nada que desplazar: se centra y ya. */
.pista.centrada {
  justify-content: center;
  padding-left: 12px;
  padding-right: 12px;
}

.puntos {
  display: flex;
  justify-content: center;
  gap: 5px;
  padding-bottom: 0;
}

.punto {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  border: none;
  padding: 0;
  background: var(--line);
  cursor: pointer;
}

.punto.activo {
  background: var(--gold-dark);
  width: 14px;
  border-radius: 3px;
}

.contador {
  text-align: center;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 10px;
  color: var(--muted);
  margin: 0 0 4px;
}
</style>
