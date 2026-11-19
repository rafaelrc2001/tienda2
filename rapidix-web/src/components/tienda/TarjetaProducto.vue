<script setup lang="ts">
/**
 * Tarjeta de producto del catálogo (HU-03, HU-07, HU-08, HU-09 y HU-10).
 *
 * Lleva el precio con los centavos en volado, el control de cantidad —con
 * escritura manual y tope de existencias—, los atajos de cantidad (cada toque
 * a «+60» suma 60; el bote de al lado regresa a cero) y, cuando
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
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
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
 * Atajos de cantidad (HU-09): son los pisos de las listas de volumen y se
 * anuncian como «Lleva más, paga menos».
 *
 * Un producto con un solo precio (Lista 1 «en adelante») no lleva atajos: antes
 * se caía a «+5» y «+10», y en la tarjeta parecían listas de precio que el
 * producto no tiene. Ahí solo queda el bote para regresar a cero.
 */
const hayPrecioEscalonado = computed(() => props.producto.escalones.length > 0)

const atajos = computed(() => props.producto.escalones)

const cantidad = computed(() => carrito.cantidadDe(props.producto.id))

/**
 * El último atajo que se tocó: es el que queda prendido en amarillo. Tocar
 * «+60» lo prende; tocar después «+120» lo pasa a ese. Se apaga cuando el
 * producto vuelve a cero (el bote, el «−» o borrando el campo).
 */
const ultimoAtajo = ref<number | null>(null)
watch(cantidad, (valor) => {
  if (valor === 0) ultimoAtajo.value = null
})

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
 * Los atajos **suman** su cantidad cada vez que se tocan: tres toques a «+60»
 * son 180. El bote de al lado lo regresa a cero. El tope de existencias se
 * sigue respetando: si no alcanza, se queda en lo que hay.
 */
function sumarAtajo(piso: number): void {
  fijar(cantidad.value + piso)
  ultimoAtajo.value = piso
}

/**
 * «Lo quiero»: suma lo que falta para la siguiente lista. El tope de
 * existencias se sigue respetando: si no alcanza, se queda en lo que hay.
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
  // El tope de existencias puede reescribir el valor y Vue deja el cursor donde caiga.
  void nextTick(() => cursorAlFinal(entrada))
}

/**
 * La cantidad se escribe siempre por la derecha, como en una calculadora.
 * iOS coloca el cursor donde cayó el dedo (casi siempre a la izquierda de un
 * número corto) y lo hace tarde, después del `focus`, del `click` y aun del
 * siguiente cuadro; también lo mueve la lupa. Por eso, mientras el campo tiene
 * el foco, cada cambio de selección lo regresa al final.
 */
function cursorAlFinal(entrada: HTMLInputElement): void {
  const fin = entrada.value.length
  if (entrada.selectionStart === fin && entrada.selectionEnd === fin) return
  entrada.setSelectionRange(fin, fin)
}

let campoConFoco: HTMLInputElement | null = null

function alCambiarSeleccion(): void {
  if (campoConFoco && document.activeElement === campoConFoco) cursorAlFinal(campoConFoco)
}

function alTocarCampo(evento: Event): void {
  const entrada = evento.target as HTMLInputElement
  if (campoConFoco !== entrada) {
    campoConFoco = entrada
    document.addEventListener('selectionchange', alCambiarSeleccion)
  }
  cursorAlFinal(entrada)
  // Respaldo para Safari viejos, que no avisan `selectionchange` dentro de un input.
  setTimeout(() => cursorAlFinal(entrada), 0)
  setTimeout(() => cursorAlFinal(entrada), 100)
}

function soltarCampo(): void {
  if (!campoConFoco) return
  campoConFoco = null
  document.removeEventListener('selectionchange', alCambiarSeleccion)
}

onBeforeUnmount(soltarCampo)

function alSalirDelCampo(): void {
  soltarCampo()
  if (!escrito.value) fijar(0)
  escrito.value = String(cantidad.value)
}
</script>

<template>
  <!--
    Agotado —deshabilitado en Productos o sin saldo de inventario— lleva el
    listón rojo en la esquina superior izquierda y el resto de la tarjeta
    apagado en gris. Lo último comprado no lleva insignia: la fila ya arranca
    centrada en ello.
  -->
  <article class="tarjeta" :class="{ activa, agotada: sinExistencias }">
    <div v-if="sinExistencias" class="cinta">
      <span>Agotado</span>
    </div>

    <div class="media" :class="{ 'sin-foto': !producto.imagenUrl }">
      <!-- Sin foto el recuadro queda vacío: ni emoji ni icono de reserva. -->
      <img v-if="producto.imagenUrl" :src="producto.imagenUrl" :alt="producto.nombre" />
    </div>

    <p class="nombre">{{ producto.nombre }}</p>

    <!-- La unidad va en la misma línea que el precio: se lee «$15 pza» de un vistazo. -->
    <p class="precio">
      <s v-if="precioTachado !== null" class="tachado">{{ dinero(precioTachado) }}</s>
      <span class="entero">{{ precio.entero }}</span><span class="centavos">{{
        precio.centavos
      }}</span>
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
          @focus="alTocarCampo"
          @click="alTocarCampo"
          @touchend="alTocarCampo"
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

      <!--
        HU-10: aparece cuando ya se lleva el 85 % del siguiente piso, en
        cualquier lista. Si esa lista no sale más barata no hay ahorro que
        prometer y la frase se queda en el precio.
      -->
      <div v-if="upsell" class="upsell">
        <p>
          Te faltan <strong>{{ upsell.faltan }} {{ producto.unidad }}</strong> para pagar
          {{ dinero(upsell.precioSiguiente) }} c/u<template v-if="upsell.ahorro > 0">
            y ahorrar {{ dinero(upsell.ahorro) }}</template
          >
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
        <template v-if="hayPrecioEscalonado">
          <span class="etiqueta promesa">Lleva más, paga menos</span>
          <button
            v-for="atajo in atajos"
            :key="atajo.piso"
            type="button"
            class="piso promesa"
            :class="{ puesto: ultimoAtajo === atajo.piso }"
            :aria-pressed="ultimoAtajo === atajo.piso"
            :disabled="maximo !== null && cantidad >= maximo"
            :title="`Desde ${atajo.piso}: ${dinero(atajo.precio)} c/u`"
            :aria-label="`Sumar ${atajo.piso} (desde ${atajo.piso}: ${dinero(atajo.precio)} cada uno)`"
            @click="sumarAtajo(atajo.piso)"
          >
            +{{ atajo.piso }}
          </button>
          <span class="medida">{{ producto.unidad }}</span>
        </template>
        <!-- El mismo bote del carrito: suelta todo lo agregado de este producto. -->
        <button
          type="button"
          class="vaciar"
          :aria-label="`Quitar todo ${producto.nombre}`"
          title="Quitar todo"
          :disabled="cantidad === 0"
          @click="fijar(0)"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
          </svg>
        </button>
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
  padding: 8px 14px 6px;
  box-shadow: var(--shadow);
  text-align: center;
  /* La tarjeta del centro se agranda sin empujar a las de al lado. */
  transform: scale(0.92);
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease;
  scroll-snap-align: center;
  /*
   * Columna: la pista del carrusel estira todas las tarjetas a la altura de la
   * más alta (la de nombre largo, la que trae «Ahorras»). Ese sobrante se lo
   * queda la foto en lugar de quedar como hueco blanco al pie.
   */
  display: flex;
  flex-direction: column;
}

.tarjeta.activa {
  transform: scale(1);
  box-shadow: 0 12px 26px rgba(0, 0, 0, 0.18);
}

/*
 * Agotada: la tarjeta entera se ve apagada —fondo gris, sin relieve y el
 * contenido desaturado— para que se distinga de un vistazo en el carrusel. El
 * listón es hermano de estos bloques y no hereda el filtro, así que se queda
 * rojo. «Avísame» se sigue pudiendo pulsar: no compra, solo avisa.
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
 * pintado con un degradado de corte seco —mitad roja, mitad transparente—
 * y el texto va girado sobre él. Recorta con el mismo radio que la tarjeta,
 * que no puede llevar `overflow` porque cortaría su propia sombra.
 */
.cinta {
  position: absolute;
  top: 0;
  left: 0;
  width: 80px;
  height: 80px;
  overflow: hidden;
  border-top-left-radius: var(--radius-md);
  background: linear-gradient(to bottom right, var(--rojo) 0 50%, transparent 50% 100%);
  pointer-events: none;
  z-index: 1;
}

/*
 * El centro del texto va en (27, 27): más cerca de la hipotenusa que de la
 * esquina, donde la franja del triángulo es lo bastante larga para la palabra
 * entera. Más arriba, el borde superior de las letras se salía del recorte.
 */
.cinta span {
  position: absolute;
  top: 22px;
  left: -23px;
  width: 100px;
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
  /*
   * 162px de base y crece con lo que sobre de la tarjeta (ver `.tarjeta`). Los
   * textos de abajo van juntos a propósito: el aire que se les quitó se lo queda
   * la foto, así que si se vuelve a separar el pie hay que bajar esta base.
   */
  flex: 1 0 162px;
  min-height: 162px;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Blanco como la tarjeta: las fotos traen fondo blanco y así no se nota el borde. */
  background: var(--white);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  margin: -8px -14px 5px;
  overflow: hidden;
  color: var(--muted);
}

/*
 * `contain`: la foto entra completa en el recuadro, sin recortarse. Lo que sobra
 * queda en blanco, igual que el fondo de las fotos, así que no se nota.
 */
.media img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* Sin foto el recuadro sí va en crema, para que el hueco se lea como imagen pendiente. */
.media.sin-foto {
  background: var(--cream-2);
}

.nombre {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink);
  line-height: 1.3;
  /* Sin alto reservado para un segundo renglón: si el nombre cabe en uno, la foto crece. */
  margin: 0;
}

.precio {
  font-family: var(--font-heading);
  font-weight: 800;
  color: var(--ink);
  margin: 3px 0 0;
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
  margin-top: 5px;
}

/*
 * Safari de iPhone le pone a los botones su propio relleno, margen y aspecto:
 * en un círculo de ancho fijo ese relleno se come el hueco del signo y lo deja
 * corrido. Se anulan y el signo se centra con flex, no con la línea de texto.
 */
.stepper button {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0;
  margin: 0;
  -webkit-appearance: none;
  appearance: none;
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
  min-width: 0;
  margin: 0;
  border-radius: 0;
  -webkit-appearance: none;
  appearance: none;
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

/* Con «+120» y el bote la fila se aprieta: si hay muchos pisos, bajan de renglón. */
.volumen {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 5px;
  margin-top: 5px;
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

/* Ancho según el número: «+5» y «+120» no caben en la misma caja fija. */
.volumen .piso {
  min-width: 28px;
  height: 26px;
  border-radius: 7px;
  border: 1.5px solid var(--line);
  background: var(--white);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 11px;
  color: var(--ink);
  cursor: pointer;
  padding: 0 4px;
}

/* El último atajo tocado, siempre en amarillo: haya o no descuento por volumen. */
.volumen .piso.puesto {
  border-color: var(--amarillo-dark);
  background: var(--amarillo);
  color: var(--ink);
}

/*
 * Los pisos son la otra mitad de «lleva más, paga menos», así que llevan su
 * mismo amarillo: el borde dice a qué cantidades se refiere la promesa y el
 * piso elegido se rellena. El texto va oscuro, que el blanco sobre amarillo no
 * se lee.
 */
.volumen .piso.promesa {
  border-color: var(--amarillo-dark);
}

.volumen .piso.promesa.puesto {
  background: var(--amarillo);
  color: var(--ink);
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

/* El bote rojo claro del carrito, en chico para que quepa en la fila. */
.volumen .vaciar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 7px;
  border: 1.5px solid color-mix(in srgb, var(--terracotta) 35%, var(--white));
  background: color-mix(in srgb, var(--terracotta) 10%, var(--white));
  color: var(--terracotta-dark);
  cursor: pointer;
}

.volumen .vaciar svg {
  width: 14px;
  height: 14px;
}

.volumen .vaciar:disabled {
  opacity: 0.35;
  cursor: default;
}

.programar {
  width: 100%;
  margin-top: 5px;
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
