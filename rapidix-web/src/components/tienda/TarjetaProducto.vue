<script setup lang="ts">
/**
 * Tarjeta de producto del catálogo (HU-03, HU-07 y HU-09).
 *
 * Lleva el precio con los centavos en volado, el control de cantidad —con
 * escritura manual y tope de existencias— y los atajos de cantidad.
 *
 * La cantidad se toca directamente contra el store del carrito: es estado
 * global de verdad, y pasarlo por props obligaría a cada carrusel a reenviar
 * cada pulsación de un «+» hasta la vista.
 */
import { computed, ref, watch } from 'vue'
import { useCarritoStore } from '@/stores/carrito'
import { partesDinero } from '@/utils/formato'
import type { ProductoRecomendado } from '@/api/tipos'

const props = defineProps<{
  producto: ProductoRecomendado
  /** La tarjeta centrada del carrusel: se agranda (HU-06). */
  activa: boolean
  /**
   * El negocio descuenta existencias. Solo entonces la cantidad se topa al
   * saldo liberado: apagado, todos los productos están en cero y topar ahí
   * dejaría la tienda sin vender nada (HU-07).
   */
  controlInventario: boolean
}>()

const emit = defineEmits<{ (e: 'programar'): void }>()

const carrito = useCarritoStore()

/**
 * Pisos de los atajos de cantidad.
 *
 * HU-09 los quiere sacados de las listas de precio (`list_p2_inferior` y
 * `list_p3_inferior`) y cae a 5 y 10 cuando el producto no las tiene. Hoy el
 * catálogo no tiene listas escalonadas, así que siempre se usa el respaldo.
 */
const PISOS = [5, 10]

/**
 * Si el precio baja al llevar más.
 *
 * Está en falso porque el catálogo todavía no tiene listas de precio
 * escalonadas: HU-08, HU-09 y HU-10 quedaron fuera de esta entrega. Mientras
 * tanto los atajos fijan cantidad pero **no se anuncian como descuento**:
 * prometer «paga menos» y cobrar lo mismo es peor que no ofrecerlo. En cuanto
 * el producto traiga sus listas, esto se lee de él y la etiqueta vuelve a ser
 * «Lleva más, paga menos».
 */
const HAY_PRECIO_ESCALONADO = false

const cantidad = computed(() => carrito.cantidadDe(props.producto.id))

/** Tope de piezas. `null` = sin tope, que es el caso normal hoy. */
const maximo = computed<number | null>(() =>
  props.controlInventario ? props.producto.aptInventario : null,
)

const sinExistencias = computed(
  () => props.producto.agotado || (maximo.value !== null && maximo.value <= 0),
)

const precio = computed(() => partesDinero(props.producto.precioVenta))

/** Lo que se ve en el campo mientras se escribe, que puede estar a medias. */
const escrito = ref(String(cantidad.value))
watch(cantidad, (valor) => {
  escrito.value = String(valor)
})

function fijar(nueva: number): void {
  carrito.fijarCantidad(props.producto.id, nueva, maximo.value ?? undefined)
}

/**
 * Escritura manual: solo dígitos.
 *
 * Se filtra sobre el valor escrito en vez de confiar en `type="number"`, que
 * en móvil deja meter signos y notación científica. Un campo vacío no borra la
 * línea todavía —se está escribiendo—, se resuelve al salir del campo.
 */
function alEscribir(evento: Event): void {
  const entrada = evento.target as HTMLInputElement
  const soloDigitos = entrada.value.replace(/\D/g, '')
  escrito.value = soloDigitos
  entrada.value = soloDigitos
  if (soloDigitos) fijar(Number(soloDigitos))
}

function alSalirDelCampo(): void {
  if (!escrito.value) fijar(0)
  escrito.value = String(cantidad.value)
}
</script>

<template>
  <!--
    Sin insignias arriba. Agotado ya lo dicen la imagen en gris y el botón
    «Avísame»; lo último comprado, que la fila arranque centrada en ello.
  -->
  <article class="tarjeta" :class="{ activa, agotada: sinExistencias }">

    <div class="media">
      <img v-if="producto.imagenUrl" :src="producto.imagenUrl" :alt="producto.nombre" />
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
        <path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8Z" stroke-linejoin="round" />
        <path d="m7 8 5-4 5 4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>

    <p class="nombre">{{ producto.nombre }}</p>

    <p class="precio">
      <span class="entero">{{ precio.entero }}</span
      ><span class="centavos">{{ precio.centavos }}</span>
    </p>
    <p class="unidad">{{ producto.unidad }}</p>

    <!-- Agotado: en vez del control de cantidad se ofrece avisar. -->
    <button v-if="sinExistencias" type="button" class="programar" @click="emit('programar')">
      Avísame
    </button>

    <template v-else>
      <div class="stepper">
        <button
          type="button"
          aria-label="Quitar uno"
          :disabled="cantidad === 0"
          @click="fijar(cantidad - 1)"
        >
          −
        </button>
        <input
          class="cantidad"
          type="text"
          inputmode="numeric"
          :aria-label="`Cantidad de ${producto.nombre}`"
          :value="escrito"
          @input="alEscribir"
          @blur="alSalirDelCampo"
        />
        <button
          type="button"
          aria-label="Añadir uno"
          :disabled="maximo !== null && cantidad >= maximo"
          @click="fijar(cantidad + 1)"
        >
          +
        </button>
      </div>

      <div class="volumen">
        <span class="etiqueta" :class="{ promesa: HAY_PRECIO_ESCALONADO }">
          {{ HAY_PRECIO_ESCALONADO ? 'Lleva más, paga menos' : 'Compra por' }}
        </span>
        <button
          v-for="piso in PISOS"
          :key="piso"
          type="button"
          class="piso"
          :class="{ puesto: cantidad === piso }"
          :disabled="maximo !== null && piso > maximo"
          @click="fijar(piso)"
        >
          {{ piso }}
        </button>
        <span class="medida">{{ producto.unidad }}</span>
      </div>
    </template>
  </article>
</template>

<style scoped>
.tarjeta {
  position: relative;
  width: 158px;
  flex-shrink: 0;
  background: var(--white);
  border-radius: var(--radius-md);
  padding: 8px 10px 9px;
  box-shadow: var(--shadow);
  text-align: center;
  /* La tarjeta del centro se agranda sin empujar a las de al lado. */
  transform: scale(0.92);
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease;
  scroll-snap-align: center;
}

.tarjeta.activa {
  transform: scale(1);
  box-shadow: 0 12px 26px rgba(42, 33, 26, 0.18);
}

.tarjeta.agotada .media {
  filter: grayscale(55%);
  opacity: 0.7;
}

.media {
  height: 62px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--cream-2);
  border-radius: 10px;
  margin-bottom: 6px;
  overflow: hidden;
  color: var(--muted);
}

.media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.media svg {
  width: 30px;
  height: 30px;
}

.nombre {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink);
  line-height: 1.25;
  min-height: 27px;
  margin: 0;
}

.precio {
  font-family: var(--font-heading);
  font-weight: 800;
  color: var(--ink);
  margin: 4px 0 0;
  line-height: 1;
}

.precio .entero {
  font-size: 21px;
}

/* Los centavos en volado, como en el diseño. */
.precio .centavos {
  font-size: 11px;
  vertical-align: super;
  margin-left: 1px;
}

.unidad {
  font-size: 9.5px;
  font-weight: 600;
  color: var(--muted);
  margin: 1px 0 0;
}

.stepper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 5px;
}

.stepper button {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1.5px solid var(--line);
  background: var(--white);
  font-weight: 800;
  font-size: 15px;
  line-height: 1;
  color: var(--ink);
  cursor: pointer;
}

.stepper button:disabled {
  opacity: 0.4;
  cursor: default;
}

.cantidad {
  width: 34px;
  border: none;
  border-bottom: 1.5px solid var(--line);
  background: transparent;
  text-align: center;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 14px;
  color: var(--ink);
  padding: 1px 0;
  outline: none;
}

.cantidad:focus {
  border-bottom-color: var(--gold-dark);
}

.volumen {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: 6px;
}

.volumen .etiqueta {
  background: var(--cream-2);
  color: var(--muted);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 7px;
  line-height: 1.15;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  padding: 4px 5px;
  border-radius: 5px;
  max-width: 46px;
}

/* Solo cuando el descuento por volumen es real se pinta en dorado. */
.volumen .etiqueta.promesa {
  background: var(--gold);
  color: var(--ink);
}

.volumen .piso {
  width: 24px;
  height: 22px;
  border-radius: 7px;
  border: 1.5px solid var(--line);
  background: var(--white);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 11px;
  color: var(--ink);
  cursor: pointer;
  padding: 0;
}

.volumen .piso.puesto {
  border-color: var(--gold-dark);
  background: var(--gold);
}

.volumen .piso:disabled {
  opacity: 0.35;
  cursor: default;
}

.volumen .medida {
  font-size: 8.5px;
  color: var(--muted);
  font-weight: 700;
}

.programar {
  width: 100%;
  margin-top: 6px;
  border: 1.5px solid var(--line);
  background: var(--cream);
  color: var(--ink);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11px;
  border-radius: 9px;
  padding: 7px 6px;
  cursor: pointer;
}
</style>
