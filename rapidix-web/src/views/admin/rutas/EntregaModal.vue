<script setup lang="ts">
/**
 * «Detalle y entrega»: todo lo que el repartidor hace en la puerta, en una hoja.
 *
 * El orden es el de la puerta: a quién y dónde, contar lo que baja del camión,
 * cobrar, firma y foto. Abajo se juntan **todos** los pendientes a la vez para
 * que no los vaya descubriendo toque a toque.
 *
 * Se captura lo que el cliente **acepta**, renglón por renglón; lo devuelto es
 * la resta. Van todos los renglones y ninguno de más: la API exige el recuento
 * completo para que un olvido de la pantalla no acabe cobrando mercancía que
 * nadie recibió.
 *
 * La pantalla no suma dinero: con cada toque manda lo aceptado y el pago a
 * `entregar/previsualizar` y pinta la cuenta que vuelve, que sale de las mismas
 * funciones que el corte. Lo que se pide cobrar aquí es lo que se liquida.
 *
 * La foto es obligatoria salvo que el almacenamiento no esté disponible (503):
 * entonces no hay forma de cumplirla y no se frena la entrega. La firma y la
 * ubicación son opcionales: el cliente puede no querer firmar o negar el GPS.
 *
 * La hoja se abre tocando el pedido en cualquier estado. Antes de «En ruta» es
 * de consulta: los pasos «Recolectado» y «En ruta» son botones (solo se
 * enciende el que toca) y la lista enseña lo pedido sin poder palomearla. El
 * paso lo da quien abrió la hoja; al releer, el pedido llega con otro estado y
 * la hoja se vuelve a montar (`:key`), ya con la carga del camión.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ErrorApi, http, subirAUrlFirmada } from '@/api/http'
import { dinero, nombreEstadoPedido, nombreMetodoPago } from '@/utils/formato'
import { reducirImagen } from '@/utils/reducirImagen'
import { itemsDeLaEntrega, pendientesParaConfirmar, piezasDelRecuento } from './recuento'
import { MOTIVOS, TITULO_PASO } from './etiquetas'
import type { RenglonContado } from './recuento'
import type { PedidoEnRuta, PrevisualizacionEntrega, ResultadoEntrega } from '@/api/tipos'

type PasoDeHoja = 'RECOLECTADO' | 'EN_RUTA'

const props = withDefaults(
  defineProps<{
    pedido: PedidoEnRuta
    /** Hay jornada viva: sin ella no se mueve nada. */
    puedeMover?: boolean
    /** Recolectar es de una entrega: solo se ofrece desde dentro de una. */
    recolectarAqui?: boolean
    /** El padre está dando un paso: los botones se apagan mientras. */
    moviendo?: boolean
  }>(),
  { puedeMover: true, recolectarAqui: false, moviendo: false },
)
const emit = defineEmits<{
  (e: 'cerrar'): void
  (e: 'entregado', resultado: ResultadoEntrega): void
  /** «Cancelar / Reportar incidencia»: lo lleva a «No entregado». */
  (e: 'incidencia'): void
  /** Un paso previo a la puerta; lo da el padre, que sabe en qué entrega va. */
  (e: 'paso', estado: PasoDeHoja): void
}>()

/** Solo en ruta se cuenta, se cobra y se firma; antes, la hoja es de consulta. */
const entregable = props.pedido.estado === 'EN_RUTA'

const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp']
const TAMANO_MAXIMO_BYTES = 5 * 1024 * 1024

/** Lo que la API firma para subir una imagen. */
interface FirmaSubida {
  urlSubida: string
  urlPublica: string
  clave: string
  destino: 'S3' | 'LOCAL'
}

/** La copia de la dirección que se congeló en el pedido. */
interface DireccionPedido {
  quienRecibe?: string | null
  telefono?: string | null
  calle?: string | null
  colonia?: string | null
  cp?: string | null
  ciudad?: string | null
  estado?: string | null
  referencias?: string | null
  lat?: number | null
  lng?: number | null
}

// ------------------------------------------------------------------
// Resumen del pedido
// ------------------------------------------------------------------

const destino = computed(() => {
  const d = (props.pedido.direccion ?? {}) as DireccionPedido
  const calle = [d.calle, d.colonia].filter(Boolean).join(', ')
  const ciudad = [d.ciudad, d.estado, d.cp].filter(Boolean).join(', ')
  const texto = [calle, ciudad].filter(Boolean).join(', ')
  return {
    nombre: d.quienRecibe || props.pedido.clienteNombre || '—',
    telefono: d.telefono || null,
    calle,
    ciudad,
    referencias: d.referencias || null,
    // Con coordenadas se va al punto exacto; sin ellas, a buscar la dirección.
    mapa:
      d.lat != null && d.lng != null
        ? `https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}`
        : texto
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(texto)}`
          : null,
  }
})

const YA_RECOLECTADO = ['RECOLECTADO', 'EN_RUTA', 'ENTREGADO']
const YA_EN_RUTA = ['EN_RUTA', 'ENTREGADO']

/**
 * Los pasos antes de la puerta. Solo se enciende el que toca, y solo si la API
 * no lo bloquea (pago, cancelado) y hay jornada viva; si no, se dice por qué.
 */
const pasos = computed(() =>
  (['RECOLECTADO', 'EN_RUTA'] as const).map((estado) => {
    const hecho = (estado === 'RECOLECTADO' ? YA_RECOLECTADO : YA_EN_RUTA).includes(
      props.pedido.estado,
    )
    const toca = props.pedido.paso.siguiente === estado
    const fueraDeEntrega = estado === 'RECOLECTADO' && !props.recolectarAqui
    return {
      estado,
      titulo: TITULO_PASO[estado]!,
      hecho,
      toca,
      bloqueado: toca && props.pedido.paso.bloqueo !== null,
      habilitado:
        toca &&
        props.pedido.paso.bloqueo === null &&
        props.puedeMover &&
        !props.moviendo &&
        !fueraDeEntrega,
    }
  }),
)

/** Por qué el paso que toca no se puede dar desde aquí. */
const avisoPaso = computed(() => {
  const paso = pasos.value.find((p) => p.toca)
  if (!paso) return ''
  if (props.pedido.paso.bloqueo) return props.pedido.paso.bloqueo.mensaje
  if (!props.puedeMover) return 'Inicia o reanuda las entregas en Rutas para moverlo.'
  if (paso.estado === 'RECOLECTADO' && !props.recolectarAqui)
    return 'Para recolectarlo, agrégalo desde una de tus entregas.'
  return ''
})

// ------------------------------------------------------------------
// Productos
// ------------------------------------------------------------------

type RenglonEnHoja = RenglonContado & {
  productoId: string
  unidad: string
  soloNombre: string
}

/**
 * Solo lo que sigue arriba del camión. Un renglón ya cerrado es el intento de
 * otro día y no se vuelve a contar. Se arranca en cero, como en la puerta: el
 * repartidor marca lo que el cliente va aceptando.
 */
const renglones = reactive<RenglonEnHoja[]>(
  props.pedido.carga
    .filter((c) => c.enCamion)
    .map((c) => ({
      pedidoItemId: c.pedidoItemId,
      productoId: c.productoId,
      nombre: `${c.nombre} (${c.unidad})`,
      soloNombre: c.nombre,
      unidad: c.unidad,
      cantidadCargada: c.cantidadCargada,
      cantidadEntregada: 0,
      motivoDevolucion: null,
    })),
)

const conteo = computed(() => piezasDelRecuento(renglones))
const aceptados = computed(
  () => renglones.filter((r) => r.cantidadEntregada >= r.cantidadCargada).length,
)

/** Lo que el pedido cotizó por renglón, para enseñarlo mientras no se acepta nada. */
const importeCotizado = new Map(props.pedido.items.map((i) => [i.productoId, i.importe]))

function importeDe(renglon: RenglonEnHoja): {
  valor: number | null
  cotizado: boolean
} {
  if (renglon.cantidadEntregada <= 0) {
    return {
      valor: importeCotizado.get(renglon.productoId) ?? null,
      cotizado: true,
    }
  }
  const previsto = cuenta.value?.renglones.find((r) => r.pedidoItemId === renglon.pedidoItemId)
  return {
    valor: previsto?.cantidadEntregada === renglon.cantidadEntregada ? previsto.importe : null,
    cotizado: false,
  }
}

/** El círculo: todo o nada, que es lo que pasa casi siempre. */
function alternar(renglon: RenglonEnHoja): void {
  renglon.cantidadEntregada =
    renglon.cantidadEntregada >= renglon.cantidadCargada ? 0 : renglon.cantidadCargada
  limpiarMotivo(renglon)
}

function ajustar(renglon: RenglonEnHoja, delta: number): void {
  const contadas = (renglon.cantidadEntregada || 0) + delta
  renglon.cantidadEntregada = Math.min(Math.max(contadas, 0), renglon.cantidadCargada)
  limpiarMotivo(renglon)
}

/** El motivo acompaña a lo que sobra, y solo a eso. */
function limpiarMotivo(renglon: RenglonEnHoja): void {
  if (renglon.cantidadEntregada >= renglon.cantidadCargada) renglon.motivoDevolucion = null
}

/** Mientras no ha aceptado nada no se pregunta por qué: todavía está contando. */
function pideMotivo(renglon: RenglonEnHoja): boolean {
  return conteo.value.entregadas > 0 && renglon.cantidadEntregada < renglon.cantidadCargada
}

// ------------------------------------------------------------------
// Cobro: la cuenta la hace la API
// ------------------------------------------------------------------

const pagoRecibido = ref('')
const cuenta = ref<PrevisualizacionEntrega | null>(null)
const errorCuenta = ref('')

/** `null` si está vacío o no es un importe: no se manda. */
const pagoNumero = computed(() => {
  const texto = pagoRecibido.value.trim().replace(',', '.')
  if (!texto) return null
  const valor = Number(texto)
  return Number.isFinite(valor) && valor >= 0 ? valor : null
})

let peticion = 0
let temporizador: ReturnType<typeof setTimeout> | undefined

/** Las respuestas viejas se descartan: gana la del último toque. */
async function recalcular(): Promise<void> {
  // Fuera de ruta la API no previsualiza: no hay nada que cobrar todavía.
  if (!entregable) return
  const numero = ++peticion
  try {
    const respuesta = await http.post<PrevisualizacionEntrega>(
      `/admin/rutas/pedidos/${props.pedido.id}/entregar/previsualizar`,
      {
        items: renglones.map((r) => ({
          pedidoItemId: r.pedidoItemId,
          cantidadEntregada: Number.isInteger(r.cantidadEntregada)
            ? Math.max(r.cantidadEntregada, 0)
            : 0,
        })),
        ...(pagoNumero.value !== null ? { pagoRecibido: pagoNumero.value } : {}),
      },
    )
    if (numero !== peticion) return
    cuenta.value = respuesta
    errorCuenta.value = ''
  } catch (fallo) {
    if (numero !== peticion) return
    errorCuenta.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos calcular el cobro.'
  }
}

watch(
  [() => renglones.map((r) => r.cantidadEntregada), pagoNumero],
  () => {
    clearTimeout(temporizador)
    temporizador = setTimeout(recalcular, 250)
  },
  { immediate: true },
)

const cobraEnEfectivo = computed(() => cuenta.value?.cobraEnEfectivo ?? false)

// ------------------------------------------------------------------
// Firma y evidencia
// ------------------------------------------------------------------

const lienzo = ref<HTMLCanvasElement | null>(null)
const hayFirma = ref(false)
let trazando = false

/** El lienzo se dibuja a la densidad de la pantalla para que el trazo no salga borroso. */
function prepararLienzo(): void {
  const canvas = lienzo.value
  if (!canvas) return
  const escala = window.devicePixelRatio || 1
  const { width, height } = canvas.getBoundingClientRect()
  canvas.width = Math.round(width * escala)
  canvas.height = Math.round(height * escala)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(escala, escala)
  ctx.lineWidth = 2.2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#1f1f1f'
  hayFirma.value = false
}

function punto(evento: PointerEvent): { x: number; y: number } {
  const caja = (evento.currentTarget as HTMLCanvasElement).getBoundingClientRect()
  return { x: evento.clientX - caja.left, y: evento.clientY - caja.top }
}

function empezarTrazo(evento: PointerEvent): void {
  const ctx = lienzo.value?.getContext('2d')
  if (!ctx) return
  ;(evento.currentTarget as HTMLCanvasElement).setPointerCapture(evento.pointerId)
  trazando = true
  const { x, y } = punto(evento)
  ctx.beginPath()
  ctx.moveTo(x, y)
}

function seguirTrazo(evento: PointerEvent): void {
  if (!trazando) return
  const ctx = lienzo.value?.getContext('2d')
  if (!ctx) return
  const { x, y } = punto(evento)
  ctx.lineTo(x, y)
  ctx.stroke()
  hayFirma.value = true
}

function terminarTrazo(): void {
  trazando = false
}

function limpiarFirma(): void {
  const canvas = lienzo.value
  canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  hayFirma.value = false
}

const fotoId = ref<string | null>(null)
const fotoUrl = ref('')
const subiendo = ref(false)
/** Se apaga si el almacenamiento responde 503: no se puede exigir lo imposible. */
const fotoExigible = ref(true)
const ubicacion = ref<{ lat: number; lng: number } | null>(null)

/**
 * Sube una imagen a la carpeta de entregas y devuelve su URL y el id que la
 * entrega guarda. Ese id solo existe cuando la API almacena la imagen: con un
 * bucket detrás la clave es `entregas/algo.jpg`, que la API rechaza, así que la
 * imagen se sube igual pero no se manda una referencia que no podrá resolver.
 */
async function subir(archivo: File): Promise<{ url: string; id: string | null }> {
  const firma = await http.post<FirmaSubida>('/uploads/firma', {
    carpeta: 'entregas',
    contentType: archivo.type,
    tamanoBytes: archivo.size,
  })
  await subirAUrlFirmada(firma.urlSubida, archivo)
  return {
    url: firma.urlPublica,
    id: firma.destino === 'LOCAL' ? firma.clave : null,
  }
}

async function adjuntarFoto(evento: Event): Promise<void> {
  const entrada = evento.target as HTMLInputElement
  const original = entrada.files?.[0]
  entrada.value = ''
  if (!original) return

  error.value = ''
  if (!TIPOS_PERMITIDOS.includes(original.type)) {
    error.value = 'Usa una foto JPG, PNG o WebP.'
    return
  }

  subiendo.value = true
  try {
    // La foto de la cámara se achica antes de viajar: pesa una fracción y deja
    // de chocar con el tope de 5 MB.
    const archivo = await reducirImagen(original)
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      error.value = 'La foto no puede pesar más de 5 MB.'
      return
    }
    const subida = await subir(archivo)
    fotoUrl.value = subida.url
    fotoId.value = subida.id
  } catch (fallo) {
    if (fallo instanceof ErrorApi && fallo.estado === 503) {
      fotoExigible.value = false
      error.value = 'La subida de fotos no está disponible ahora mismo. Puedes entregar sin ella.'
    } else {
      error.value = 'No pudimos subir la foto. Inténtalo otra vez.'
    }
  } finally {
    subiendo.value = false
  }
}

/** La firma viaja como PNG al confirmar; si falla, no frena la entrega. */
async function subirFirma(): Promise<string | null> {
  const canvas = lienzo.value
  if (!canvas || !hayFirma.value) return null
  const blob = await new Promise<Blob | null>((resolver) => canvas.toBlob(resolver, 'image/png'))
  if (!blob) return null
  try {
    const subida = await subir(new File([blob], 'firma.png', { type: 'image/png' }))
    return subida.id
  } catch {
    return null
  }
}

/**
 * La ubicación se pide sola al abrir: es un dato de la entrega y pedírsela al
 * repartidor sería un toque más en la puerta. Si la niega, se entrega igual.
 */
onMounted(() => {
  if (!entregable) return
  prepararLienzo()
  navigator.geolocation?.getCurrentPosition(
    (posicion) => {
      ubicacion.value = {
        lat: posicion.coords.latitude,
        lng: posicion.coords.longitude,
      }
    },
    () => {},
    { enableHighAccuracy: true, timeout: 10000 },
  )
})

onBeforeUnmount(() => clearTimeout(temporizador))

// ------------------------------------------------------------------
// Confirmar
// ------------------------------------------------------------------

const nota = ref('')
const enviando = ref(false)
const error = ref('')

const pendientes = computed(() =>
  pendientesParaConfirmar({
    renglones,
    conFoto: fotoUrl.value !== '',
    fotoExigible: fotoExigible.value,
    cubre: cuenta.value && !errorCuenta.value ? cuenta.value.cubre : null,
  }),
)

const puedeConfirmar = computed(
  () => pendientes.value.length === 0 && !subiendo.value && !enviando.value,
)

async function entregar(): Promise<void> {
  if (!puedeConfirmar.value) return

  enviando.value = true
  error.value = ''
  try {
    const firmaId = await subirFirma()
    const resultado = await http.post<ResultadoEntrega>(
      `/admin/rutas/pedidos/${props.pedido.id}/entregar`,
      {
        items: itemsDeLaEntrega(renglones),
        ...(fotoId.value ? { fotoId: fotoId.value } : {}),
        ...(firmaId ? { firmaId } : {}),
        ...(ubicacion.value ?? {}),
        ...(cobraEnEfectivo.value && pagoNumero.value !== null
          ? { pagoRecibido: pagoNumero.value }
          : {}),
        ...(nota.value.trim() ? { nota: nota.value.trim() } : {}),
      },
    )
    emit('entregado', resultado)
  } catch (fallo) {
    error.value =
      fallo instanceof ErrorApi
        ? fallo.message
        : 'No pudimos cerrar la entrega. Inténtalo otra vez.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('cerrar')">
    <div class="modal-sheet hoja" role="dialog" aria-label="Detalle y entrega">
      <header class="cabecera">
        <p class="titulo">Detalle y entrega {{ pedido.folio }}</p>
        <button type="button" class="cerrar" aria-label="Cerrar" @click="emit('cerrar')">✕</button>
      </header>

      <div class="cuerpo">
        <!-- Resumen del pedido -->
        <section class="tarjeta">
          <div class="encabezado">
            <p class="etiqueta">Resumen del pedido</p>
            <span class="estado">{{ nombreEstadoPedido(pedido.estado, pedido.pago.estado) }}</span>
          </div>
          <p class="fila-nombre">
            <span class="apagado">Nombre</span>
            <strong>{{ destino.nombre }}</strong>
          </p>
          <p v-if="destino.calle" class="apagado">{{ destino.calle }}</p>
          <p v-if="destino.ciudad" class="apagado">{{ destino.ciudad }}</p>
          <p v-if="destino.referencias" class="referencias">🏠 {{ destino.referencias }}</p>
          <div class="dos">
            <a v-if="destino.telefono" :href="`tel:${destino.telefono}`" class="boton-claro">
              📞 {{ destino.telefono }}
            </a>
            <span v-else class="boton-claro apagado">📞 Sin tel.</span>
            <a
              v-if="destino.mapa"
              :href="destino.mapa"
              target="_blank"
              rel="noopener"
              class="boton-claro"
            >
              📍 Mapas
            </a>
            <span v-else class="boton-claro apagado">📍 Sin dirección</span>
          </div>
        </section>

        <div class="dos pasos">
          <button
            v-for="paso in pasos"
            :key="paso.estado"
            type="button"
            class="paso"
            :class="{ hecho: paso.hecho, toca: paso.habilitado }"
            :disabled="!paso.habilitado"
            @click="emit('paso', paso.estado)"
          >
            <template v-if="paso.hecho">✓ </template>
            <template v-else-if="paso.bloqueado">🔒 </template>
            <template v-if="paso.toca && moviendo">…</template>
            <template v-else>{{ paso.titulo }}</template>
          </button>
        </div>
        <p v-if="avisoPaso" class="aviso-paso">{{ avisoPaso }}</p>

        <!-- Antes de ruta: lo pedido, sin palomear, y su total. -->
        <template v-if="!entregable">
          <p class="etiqueta seccion">Lista de productos</p>
          <ul class="productos">
            <li v-for="item in pedido.items" :key="item.productoId" class="tarjeta producto">
              <div class="linea">
                <span class="nombre">
                  {{ item.nombre }}
                  <span class="apagado">× {{ item.cantidad }}</span>
                </span>
                <span class="importe">{{ dinero(item.importe) }}</span>
                <span class="check apagado-check" aria-hidden="true" />
              </div>
            </li>
          </ul>
          <p class="total total-consulta">
            <span>Total</span>
            <span>{{ dinero(pedido.total) }}</span>
          </p>
        </template>

        <template v-else>
          <!-- Lista de productos y verificación -->
          <div class="encabezado seccion">
            <p class="etiqueta">Lista de productos y verificación</p>
            <span class="contador-aceptados">
              {{ aceptados }} de {{ renglones.length }} aceptados
            </span>
          </div>
          <ul class="productos">
            <li v-for="renglon in renglones" :key="renglon.pedidoItemId" class="tarjeta producto">
              <div class="linea">
                <span class="nombre">
                  {{ renglon.soloNombre }}
                  <span class="apagado">× {{ renglon.cantidadCargada }}</span>
                </span>
                <span class="importe" :class="{ apagado: importeDe(renglon).cotizado }">
                  {{ importeDe(renglon).valor === null ? '…' : dinero(importeDe(renglon).valor!) }}
                </span>
                <button
                  type="button"
                  class="check"
                  :class="{
                    lleno: renglon.cantidadEntregada >= renglon.cantidadCargada,
                    parcial:
                      renglon.cantidadEntregada > 0 &&
                      renglon.cantidadEntregada < renglon.cantidadCargada,
                  }"
                  :aria-pressed="renglon.cantidadEntregada >= renglon.cantidadCargada"
                  :aria-label="`Aceptar ${renglon.soloNombre}`"
                  @click="alternar(renglon)"
                >
                  {{ renglon.cantidadEntregada >= renglon.cantidadCargada ? '✓' : '' }}
                </button>
              </div>

              <!-- Con más de una pieza se puede aceptar una parte. -->
              <div v-if="renglon.cantidadCargada > 1" class="parcialidad">
                <span class="apagado">Acepta</span>
                <button
                  type="button"
                  class="paso-cantidad"
                  aria-label="Una menos"
                  :disabled="renglon.cantidadEntregada <= 0"
                  @click="ajustar(renglon, -1)"
                >
                  −
                </button>
                <input
                  v-model.number="renglon.cantidadEntregada"
                  class="form-input cantidad"
                  type="number"
                  inputmode="numeric"
                  min="0"
                  :max="renglon.cantidadCargada"
                  @change="limpiarMotivo(renglon)"
                />
                <button
                  type="button"
                  class="paso-cantidad"
                  aria-label="Una más"
                  :disabled="renglon.cantidadEntregada >= renglon.cantidadCargada"
                  @click="ajustar(renglon, 1)"
                >
                  +
                </button>
                <span class="apagado">de {{ renglon.cantidadCargada }} {{ renglon.unidad }}</span>
              </div>

              <!-- En cuanto sobra una pieza hay que decir por qué. -->
              <select
                v-if="pideMotivo(renglon)"
                v-model="renglon.motivoDevolucion"
                class="select-input motivo"
              >
                <option :value="null">¿Por qué no se lo quedó?</option>
                <option v-for="m in MOTIVOS" :key="m.valor" :value="m.valor">
                  {{ m.etiqueta }}
                </option>
              </select>
            </li>
          </ul>
          <p v-if="conteo.devueltas > 0 && conteo.entregadas > 0" class="nota-camion">
            {{ conteo.devueltas }} pieza(s) siguen en tu camión hasta el corte.
          </p>

          <!-- Confirmación y cobro -->
          <p class="etiqueta seccion">Confirmación y cobro</p>
          <section class="tarjeta cobro">
            <template v-if="cuenta">
              <p class="renglon-cuenta">
                <span>Productos entregados</span><strong>{{ dinero(cuenta.productos) }}</strong>
              </p>
              <p v-if="cuenta.envio > 0" class="renglon-cuenta">
                <span>Envío a domicilio</span><strong>{{ dinero(cuenta.envio) }}</strong>
              </p>
              <p v-if="cuenta.recargoFuera > 0" class="renglon-cuenta">
                <span>Recargo fuera de horario</span>
                <strong>{{ dinero(cuenta.recargoFuera) }}</strong>
              </p>
              <p v-if="cuenta.descuento > 0" class="renglon-cuenta">
                <span>{{ pedido.cupon ? `Cupón ${pedido.cupon.code}` : 'Descuento' }}</span>
                <strong>−{{ dinero(cuenta.descuento) }}</strong>
              </p>
              <p v-if="cuenta.billetera > 0" class="renglon-cuenta">
                <span>Pagó con su billetera</span><strong>−{{ dinero(cuenta.billetera) }}</strong>
              </p>

              <p class="total">
                <span>{{ cobraEnEfectivo ? 'Total a cobrar' : 'A cobrar' }}</span>
                <span>{{ dinero(cuenta.aCobrar) }}</span>
              </p>
              <p class="apagado metodo">
                Método de pago:
                {{ pedido.pago.metodo === 'EFECTIVO' ? '💵' : '' }}
                {{ nombreMetodoPago(pedido.pago.metodo) }}
                <template v-if="!cobraEnEfectivo"> · no cobras nada en la puerta</template>
              </p>

              <template v-if="cobraEnEfectivo">
                <label class="etiqueta-campo" for="pago-recibido">Pago recibido</label>
                <input
                  id="pago-recibido"
                  v-model="pagoRecibido"
                  class="form-input pago"
                  type="text"
                  inputmode="decimal"
                  placeholder="0.00"
                  autocomplete="off"
                />
                <p v-if="pedido.pago.pagoCon !== null" class="apagado pista">
                  Dijo que pagaría con {{ dinero(pedido.pago.pagoCon) }}
                </p>
                <p class="cambio">
                  Cambio a entregar:
                  <strong>{{ cuenta.cambio === null ? '—' : dinero(cuenta.cambio) }}</strong>
                </p>
              </template>
            </template>
            <p v-else-if="errorCuenta" class="form-error">{{ errorCuenta }}</p>
            <p v-else class="apagado">Calculando el cobro…</p>
          </section>

          <p class="aviso-cashback">
            ↺ Aviso de cashback:
            <template v-if="pedido.cashbackGenerado > 0">
              este pedido le genera {{ dinero(pedido.cashbackGenerado) }} al cliente; entra a su
              billetera cuando el pago quede pagado.
            </template>
            <template v-else>este pedido no generó cashback.</template>
          </p>

          <!-- Firma y evidencia -->
          <p class="etiqueta seccion">Firma y evidencia</p>
          <p class="apagado leyenda">Firmo de conformidad que he recibido mi pedido.</p>
          <canvas
            ref="lienzo"
            class="lienzo"
            aria-label="Firma del cliente"
            @pointerdown="empezarTrazo"
            @pointermove="seguirTrazo"
            @pointerup="terminarTrazo"
            @pointercancel="terminarTrazo"
            @pointerleave="terminarTrazo"
          />
          <button type="button" class="enlace" :disabled="!hayFirma" @click="limpiarFirma">
            Limpiar firma
          </button>

          <div class="evidencia">
            <label class="boton-claro foto" :class="{ deshabilitado: subiendo }">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                :disabled="subiendo"
                @change="adjuntarFoto"
              />
              {{ subiendo ? 'Subiendo…' : fotoUrl ? '📷 Cambiar foto' : '📷 Tomar foto' }}
            </label>
            <a v-if="fotoUrl" :href="fotoUrl" target="_blank" rel="noopener" class="enlace">
              Ver foto
            </a>
            <span v-else class="enlace apagado">Ver foto</span>
          </div>

          <textarea
            v-model="nota"
            class="form-textarea"
            rows="2"
            maxlength="500"
            placeholder="Nota de la entrega (opcional)"
          />

          <p v-if="pendientes.length > 0" class="pendientes">
            ⚠️ Para confirmar: {{ pendientes.join(' · ') }}.
          </p>
          <p v-if="error" class="form-error">{{ error }}</p>

          <button type="button" class="incidencia" :disabled="enviando" @click="emit('incidencia')">
            × Cancelar / Reportar incidencia
          </button>
          <button
            type="button"
            class="btn-primary confirmar"
            :disabled="!puedeConfirmar"
            @click="entregar"
          >
            {{ enviando ? 'Cerrando…' : '✓ Confirmar pedido y entrega' }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* La hoja lleva su propia cabecera: el relleno pasa al cuerpo. */
.hoja {
  padding: 0;
  background: var(--white);
}

.cabecera {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: var(--verde-compra);
  padding: 14px 18px;
}

.cabecera .titulo {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 16px;
  color: var(--white);
}

.cerrar {
  background: none;
  border: none;
  color: var(--white);
  font-size: 18px;
  cursor: pointer;
  padding: 2px 4px;
}

.cuerpo {
  padding: 14px 16px 20px;
}

/* Especificidad cero: cada párrafo pone su propio margen sin pelear con este. */
:where(.cuerpo p) {
  margin: 0;
}

.tarjeta {
  background: var(--white);
  border: 1.5px solid var(--line);
  border-radius: var(--radius-md);
  padding: 12px 14px;
}

.encabezado {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.etiqueta {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

.seccion {
  margin: 16px 0 8px;
}

.estado {
  background: var(--cream-2);
  color: var(--verde-compra);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11.5px;
  padding: 4px 10px;
  border-radius: 999px;
  white-space: nowrap;
}

.apagado {
  color: var(--muted);
}

.fila-nombre {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
  color: var(--ink);
}

.tarjeta > .apagado {
  font-size: 12.5px;
  line-height: 1.45;
}

.referencias {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ink);
}

.dos {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 10px;
}

.boton-claro {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: var(--white);
  border: 1.5px solid var(--line);
  border-radius: 11px;
  padding: 9px 10px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  color: var(--ink);
  text-decoration: none;
  cursor: pointer;
  min-width: 0;
}

.boton-claro.apagado {
  color: var(--muted);
  cursor: default;
}

.pasos .paso {
  text-align: center;
  border: 1.5px solid var(--line);
  border-radius: 11px;
  padding: 8px 10px;
  font-size: 12.5px;
  color: var(--muted);
}

.pasos .paso {
  background: var(--white);
  font-family: var(--font-heading);
  font-weight: 700;
  cursor: default;
}

.pasos .paso.hecho {
  color: var(--verde-compra);
  border-color: var(--verde);
}

/* El único paso que se puede dar: verde lleno, como el botón principal. */
.pasos .paso.toca {
  background: var(--verde-compra);
  border-color: var(--verde-compra);
  color: var(--white);
  cursor: pointer;
}

.aviso-paso {
  margin-top: 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--orange-dark);
}

.check.apagado-check {
  display: inline-block;
  opacity: 0.5;
  cursor: default;
}

.total-consulta {
  border-top: none;
  margin-top: 12px;
  font-weight: 600;
}

.total-consulta span:last-child {
  font-weight: 800;
}

.contador-aceptados {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11.5px;
  color: var(--muted);
  white-space: nowrap;
}

.productos {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.producto .linea {
  display: flex;
  align-items: center;
  gap: 10px;
}

.producto .nombre {
  flex: 1;
  min-width: 0;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13.5px;
  color: var(--ink);
}

.producto .importe {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13.5px;
  color: var(--ink);
  white-space: nowrap;
}

.producto .importe.apagado {
  color: var(--muted);
  font-weight: 700;
}

.check {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid var(--line);
  background: var(--white);
  color: var(--white);
  font-weight: 800;
  cursor: pointer;
}

.check.lleno {
  background: var(--verde);
  border-color: var(--verde-dark);
}

.check.parcial {
  border-color: var(--amarillo-dark);
  background: linear-gradient(90deg, var(--amarillo) 50%, var(--white) 50%);
}

.parcialidad {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
}

.paso-cantidad {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--line);
  background: var(--cream-2);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 14px;
  color: var(--ink);
  cursor: pointer;
}

.paso-cantidad:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.parcialidad .cantidad {
  width: 48px;
  margin: 0;
  padding: 5px 4px;
  text-align: center;
  font-family: var(--font-heading);
  font-weight: 700;
}

.motivo {
  margin: 8px 0 0;
}

.nota-camion {
  margin-top: 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--orange-dark);
}

.cobro {
  background: var(--cream);
}

.renglon-cuenta {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 12.5px;
  color: var(--muted);
  margin-bottom: 6px;
}

.renglon-cuenta strong {
  color: var(--ink);
}

.total {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  border-top: 1.5px solid var(--line);
  padding-top: 10px;
  margin-top: 4px;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 16px;
  color: var(--ink);
}

.metodo {
  font-size: 12px;
  margin-top: 2px;
}

.etiqueta-campo {
  display: block;
  margin: 12px 0 6px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  color: var(--ink);
}

/* Campo de captura en blanco sobre el bloque crema. */
.pago {
  margin: 0;
  background: var(--white);
  text-align: right;
  font-size: 16px;
}

.pista {
  margin-top: 4px;
  font-size: 11.5px;
}

.cambio {
  margin-top: 10px;
  font-size: 13px;
  color: var(--ink);
}

.aviso-cashback {
  margin-top: 12px;
  background: var(--amarillo);
  border: 1.5px solid var(--amarillo-dark);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.45;
}

.leyenda {
  font-size: 12.5px;
  margin-bottom: 8px;
}

.lienzo {
  display: block;
  width: 100%;
  height: 150px;
  border: 2px dashed var(--verde-compra);
  border-radius: var(--radius-md);
  background: var(--white);
  /* Sin esto, arrastrar el dedo desplaza la hoja en vez de firmar. */
  touch-action: none;
}

.enlace {
  background: none;
  border: none;
  padding: 8px 4px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  color: var(--muted);
  text-decoration: none;
  cursor: pointer;
}

.enlace:disabled {
  opacity: 0.5;
  cursor: default;
}

a.enlace {
  color: var(--terracotta-dark);
}

.evidencia {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 6px 0 12px;
}

.foto input {
  display: none;
}

.foto.deshabilitado {
  opacity: 0.55;
  cursor: not-allowed;
}

.pendientes {
  margin-top: 12px;
  background: var(--cream);
  border-left: 4px solid var(--orange-dark);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  color: var(--orange-dark);
  line-height: 1.45;
}

.incidencia {
  display: block;
  width: 100%;
  margin: 10px 0;
  background: none;
  border: none;
  padding: 8px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13px;
  color: var(--muted);
  cursor: pointer;
}

.confirmar {
  width: 100%;
  background: var(--verde-compra);
  border-color: var(--verde-compra);
  box-shadow: none;
}
</style>
