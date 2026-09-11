<script setup lang="ts">
/**
 * Tarjeta de producto del catálogo (HU-03, HU-07, HU-08, HU-09 y HU-10).
 *
 * Lleva el precio con los centavos en volado, el control de cantidad —con
 * escritura manual y tope de existencias—, los atajos de cantidad y, cuando
 * el producto tiene listas de volumen, el precio escalonado: tachado, cuánto
 * ahorra y la oferta de «te faltan N».
 *
 * La cantidad se toca directamente contra el store del carrito: es estado
 * global de verdad, y pasarlo por props obligaría a cada carrusel a reenviar
 * cada pulsación de un «+» hasta la vista.
 *
 * Ningún precio se calcula aquí. El de cada línea lo da la API; sin línea
 * calculada se enseña el precio de venta, que es el de la primera pieza.
 */
import { computed, ref, watch } from 'vue'
import { useCarritoStore } from '@/stores/carrito'
import { dinero, partesDinero } from '@/utils/formato'
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
 * Pisos de respaldo de los atajos de cantidad (HU-09).
 *
 * Con listas de volumen los atajos son sus pisos y se anuncian como «Lleva
 * más, paga menos». Sin listas se cae a 5 y 10, pero **no se anuncian como
 * descuento**: el precio no baja, y prometer «paga menos» y cobrar lo mismo es
 * peor que no ofrecerlo.
 */
const PISOS_RESPALDO = [5, 10]

const hayPrecioEscalonado = computed(() => props.producto.escalones.length > 0)

const atajos = computed<{ piso: number; precio: number | null }[]>(() =>
  hayPrecioEscalonado.value
    ? props.producto.escalones
    : PISOS_RESPALDO.map((piso) => ({ piso, precio: null })),
)

const cantidad = computed(() => carrito.cantidadDe(props.producto.id))

/** La línea tal como la valoró la API, si ya respondió a esta cantidad. */
const linea = computed(() => carrito.lineaCalculada(props.producto.id))

/** Tope de piezas. `null` = sin tope, que es el caso normal hoy. */
const maximo = computed<number | null>(() =>
  props.controlInventario ? props.producto.aptInventario : null,
)

const sinExistencias = computed(
  () => props.producto.agotado || (maximo.value !== null && maximo.value <= 0),
)

const precio = computed(() =>
  partesDinero(linea.value?.precioUnitario ?? props.producto.precioVenta),
)
const precioTachado = computed(() => linea.value?.precioLista ?? null)
const ahorro = computed(() => linea.value?.ahorro ?? 0)
const upsell = computed(() => linea.value?.upsell ?? null)

/** Lo que se ve en el campo mientras se escribe, que puede estar a medias. */
const escrito = ref(String(cantidad.value))
watch(cantidad, (valor) => {
  escrito.value = String(valor)
})

function fijar(nueva: number): void {
  carrito.fijarCantidad(props.producto.id, nueva, maximo.value ?? undefined)
}

/**
 * «Lo quiero»: **suma** lo que falta para la siguiente lista, a diferencia de
 * los atajos, que fijan la cantidad. El tope de existencias se sigue
 * respetando: si no alcanza, se queda en lo que hay.
 */
function aceptarUpsell(): void {
  if (upsell.value) fijar(cantidad.value + upsell.value.faltan)
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
    Agotado —deshabilitado en Productos o sin saldo de inventario— lleva el
    listón naranja en la esquina superior izquierda y el resto de la tarjeta
    apagado en gris. Lo último comprado no lleva insignia: la fila ya arranca
    centrada en ello.
  -->
  <article class="tarjeta" :class="{ activa, agotada: sinExistencias }">
    <div v-if="sinExistencias" class="cinta">
      <span>Agotado</span>
    </div>

    <div class="media" :class="{ 'sin-foto': !producto.imagenUrl }">
      <img v-if="producto.imagenUrl" :src="producto.imagenUrl" :alt="producto.nombre" />
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
        <path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8Z" stroke-linejoin="round" />
        <path d="m7 8 5-4 5 4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>

    <p class="nombre">{{ producto.nombre }}</p>

    <!-- La unidad va en la misma línea que el precio: se lee «$15 pza» de un vistazo. -->
    <p class="precio">
      <s v-if="precioTachado !== null" class="tachado">{{ dinero(precioTachado) }}</s>
      <span class="entero">{{ precio.entero }}</span
      ><span class="centavos">{{ precio.centavos }}</span>
      <span class="unidad">{{ producto.unidad }}</span>
    </p>
    <p v-if="ahorro > 0" class="ahorro">Ahorras {{ dinero(ahorro) }}</p>

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

      <!-- HU-10: solo aparece cuando ya se lleva el 80 % del siguiente piso. -->
      <div v-if="upsell" class="upsell">
        <p>
          Te faltan <strong>{{ upsell.faltan }} {{ producto.unidad }}</strong> para pagar
          {{ dinero(upsell.precioSiguiente) }} c/u y ahorrar {{ dinero(upsell.ahorro) }}
        </p>
        <button
          type="button"
          :disabled="maximo !== null && cantidad >= maximo"
          @click="aceptarUpsell"
        >
          Lo quiero
        </button>
      </div>

      <div class="volumen">
        <span class="etiqueta" :class="{ promesa: hayPrecioEscalonado }">
          {{ hayPrecioEscalonado ? 'Lleva más, paga menos' : 'Compra por' }}
        </span>
        <button
          v-for="atajo in atajos"
          :key="atajo.piso"
          type="button"
          class="piso"
          :class="{ puesto: cantidad === atajo.piso }"
          :disabled="maximo !== null && atajo.piso > maximo"
          :title="atajo.precio !== null ? `Desde ${atajo.piso}: ${dinero(atajo.precio)} c/u` : undefined"
          :aria-label="
            atajo.precio !== null
              ? `Llevar ${atajo.piso} a ${dinero(atajo.precio)} cada uno`
              : `Llevar ${atajo.piso}`
          "
          @click="fijar(atajo.piso)"
        >
          {{ atajo.piso }}
        </button>
        <span class="medida">{{ producto.unidad }}</span>
      </div>
    </template>
  </article>
</template>

<style scoped>
.tarjeta {
  position: relative;
  /*
   * Ancha y con la foto baja: la tarjeta queda casi cuadrada, no una columna alta.
   * El ancho lo marca la fila de volumen —etiqueta + los pisos + la unidad—, que
   * es lo que primero se apelotona; si se toca aquí hay que tocar el colchón
   * lateral de `.pista` en CarruselFamilia, que es la mitad de este ancho.
   */
  width: 214px;
  flex-shrink: 0;
  background: var(--white);
  border-radius: var(--radius-md);
  padding: 8px 14px 11px;
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
  box-shadow: 0 12px 26px rgba(0, 0, 0, 0.18);
}

/*
 * Agotada: la tarjeta entera se ve apagada —fondo gris, sin relieve y el
 * contenido desaturado— para que se distinga de un vistazo en el carrusel. El
 * listón es hermano de estos bloques y no hereda el filtro, así que se queda
 * naranja. «Avísame» se sigue pudiendo pulsar: no compra, solo avisa.
 */
.tarjeta.agotada {
  background: var(--cream-2);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.06);
}

.tarjeta.agotada.activa {
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.08);
}

.tarjeta.agotada .media,
.tarjeta.agotada .nombre,
.tarjeta.agotada .precio,
.tarjeta.agotada .ahorro {
  filter: grayscale(100%);
  opacity: 0.5;
}

/* La foto va a sangre: su fondo blanco delataría el recorte sobre el gris. */
.tarjeta.agotada .media,
.tarjeta.agotada .media.sin-foto {
  background: transparent;
}

/* El botón también se apaga: lo que se ofrece es esperar, no comprar. */
.tarjeta.agotada .programar {
  background: transparent;
  color: var(--muted);
}

/*
 * Listón macizo en la esquina superior izquierda: la caja es un triángulo
 * pintado con un degradado de corte seco —mitad naranja, mitad transparente—
 * y el texto va girado sobre él. Recorta con el mismo radio que la tarjeta,
 * que no puede llevar `overflow` porque cortaría su propia sombra.
 */
.cinta {
  position: absolute;
  top: 0;
  left: 0;
  width: 74px;
  height: 74px;
  overflow: hidden;
  border-top-left-radius: var(--radius-md);
  background: linear-gradient(to bottom right, var(--orange) 0 50%, transparent 50% 100%);
  pointer-events: none;
  z-index: 1;
}

.cinta span {
  position: absolute;
  top: 14px;
  left: -26px;
  width: 104px;
  transform: rotate(-45deg);
  color: var(--white);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-align: center;
  line-height: 1;
}

/*
 * La foto va a sangre: anula el padding de la tarjeta arriba y a los lados para
 * ocupar todo el ancho, con las esquinas de arriba de la propia tarjeta.
 */
.media {
  height: 108px;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Blanco como la tarjeta: las fotos traen fondo blanco y así no se nota el borde. */
  background: var(--white);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  margin: -8px -14px 8px;
  overflow: hidden;
  color: var(--muted);
}

/*
 * `cover`: la foto llena el recuadro de lado a lado. Las fotos de producto traen
 * aire alrededor, así que lo que se recorta de los bordes es fondo, no producto.
 */
.media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Sin foto el recuadro sí va en crema, para que el hueco se lea como imagen pendiente. */
.media.sin-foto {
  background: var(--cream-2);
}

.media svg {
  width: 30px;
  height: 30px;
}

.nombre {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink);
  line-height: 1.3;
  min-height: 30px;
  margin: 0;
}

.precio {
  font-family: var(--font-heading);
  font-weight: 800;
  color: var(--ink);
  margin: 7px 0 0;
  line-height: 1;
}

.precio .entero {
  font-size: 23px;
}

/* Los centavos en volado, como en el diseño. */
.precio .centavos {
  font-size: 12px;
  vertical-align: super;
  margin-left: 1px;
}

.precio .unidad {
  font-family: var(--font-body);
  font-size: 10.5px;
  font-weight: 600;
  color: var(--muted);
  margin-left: 4px;
}

/* El precio de la lista anterior, pequeño y a la izquierda del que se cobra. */
.precio .tachado {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 600;
  color: var(--muted);
  margin-right: 4px;
}

.ahorro {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 10.5px;
  color: var(--sage);
  margin: 4px 0 0;
}

.stepper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 9px;
}

.stepper button {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1.5px solid var(--line);
  background: var(--white);
  font-weight: 800;
  font-size: 16px;
  line-height: 1;
  color: var(--ink);
  cursor: pointer;
}

.stepper button:disabled {
  opacity: 0.4;
  cursor: default;
}

.cantidad {
  width: 42px;
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

/* Sin recuadro: es un aviso dentro de la tarjeta, no una segunda tarjeta. */
.upsell {
  margin-top: 6px;
}

.upsell p {
  font-size: 9.5px;
  line-height: 1.3;
  color: var(--ink);
  margin: 0 0 4px;
}

/* Verde: la acción de ahorrar, distinta del dorado de los atajos de cantidad. */
.upsell button {
  width: 100%;
  border: none;
  background: var(--sage);
  color: var(--white);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 10.5px;
  border-radius: 7px;
  padding: 4px 6px;
  cursor: pointer;
}

.upsell button:disabled {
  opacity: 0.4;
  cursor: default;
}

.volumen {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 10px;
}

.volumen .etiqueta {
  background: var(--cream-2);
  color: var(--muted);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 7.5px;
  line-height: 1.2;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  padding: 5px 7px;
  border-radius: 5px;
  /*
   * Dos renglones exactos para la promesa, partida por la coma. El ancho de
   * contenido —los 7px de padding cuentan, que el box-sizing es border-box—
   * da para «PAGA MENOS» pero no para «LLEVA MÁS, PAGA»: con menos salian
   * tres lineas y con mas cabia todo en una.
   */
  max-width: 64px;
}

/*
 * Solo cuando el descuento por volumen es real se pinta en amarillo: el mismo
 * del billete de cashback, porque las dos cosas son ahorro. Texto oscuro, que
 * el blanco sobre amarillo no se lee.
 */
.volumen .etiqueta.promesa {
  background: var(--amarillo);
  color: var(--ink);
}

.volumen .piso {
  width: 28px;
  height: 26px;
  border-radius: 7px;
  border: 1.5px solid var(--line);
  background: var(--white);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 12px;
  color: var(--ink);
  cursor: pointer;
  padding: 0;
}

.volumen .piso.puesto {
  border-color: var(--gold-dark);
  background: var(--gold);
  color: var(--white);
}

.volumen .piso:disabled {
  opacity: 0.35;
  cursor: default;
}

.volumen .medida {
  font-size: 9px;
  color: var(--muted);
  font-weight: 700;
}

.programar {
  width: 100%;
  margin-top: 9px;
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
