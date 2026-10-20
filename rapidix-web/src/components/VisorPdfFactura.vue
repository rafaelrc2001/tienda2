<script setup lang="ts">
/**
 * Visor del PDF de la factura: Mis pedidos y Finanzas.
 *
 * El PDF se pinta con pdf.js en un `<canvas>` por página en vez de dárselo al
 * visor del navegador: en Android y en los navegadores dentro de WhatsApp o
 * Facebook un PDF «inline» se descarga o sale en blanco, y un `<iframe>` no
 * lleva el Bearer. Así se ve igual en todos lados y los errores son los
 * nuestros.
 *
 * Los bytes se bajan una sola vez y el mismo blob sirve para pintar, compartir
 * y descargar: el PDF no se vuelve a generar en la API por cada botón.
 *
 * Si la API no lo entrega (404, sin red) la hoja se cierra con el aviso; si lo
 * entrega pero pdf.js no puede pintarlo, queda el botón de descarga, que no
 * depende del visor.
 */
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
// El worker sale del mismo paquete que la librería: si las versiones no casan,
// pdf.js no pinta nada. `?url` lo deja como archivo propio del build, del
// mismo origen que la app (un worker de otro origen se bloquea).
import urlWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { guardarBlob, obtenerArchivo } from '@/api/http'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{
  /** Ruta de la API que devuelve el PDF. */
  ruta: string
  /** Nombre del archivo al descargarlo o compartirlo. */
  nombre: string
  titulo: string
}>()

const emit = defineEmits<{ (e: 'cerrar'): void }>()

const ui = useUiStore()

const estado = ref<'cargando' | 'listo' | 'error'>('cargando')
const contenedor = ref<HTMLDivElement | null>(null)
const blob = shallowRef<Blob | null>(null)

/** Solo se ofrece «Compartir» donde el navegador acepta mandar el archivo. */
const puedeCompartir = ref(false)

const cancelacion = new AbortController()
/** Con ella se libera el worker; sirve también si la hoja se cierra a media carga. */
let carga: PDFDocumentLoadingTask | null = null
let documento: PDFDocumentProxy | null = null
let tareas: RenderTask[] = []
/** Cada repintado tiene su número: uno viejo que sigue en el bucle se detiene. */
let pintado = 0
let anchoPintado = 0
let observador: ResizeObserver | null = null
let espera: ReturnType<typeof setTimeout> | undefined

onMounted(async () => {
  try {
    blob.value = await obtenerArchivo(props.ruta, cancelacion.signal)
  } catch (fallo) {
    if (fallo instanceof DOMException && fallo.name === 'AbortError') return
    ui.errorDeApi(fallo)
    emit('cerrar')
    return
  }
  puedeCompartir.value = aceptaArchivos(archivo())

  try {
    // pdf.js pesa: se baja solo cuando alguien abre una factura. El build
    // `legacy` aguanta los teléfonos y WebViews que el moderno deja fuera.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = urlWorker
    // Los bytes ya bajados y no la URL: si se le da `url`, pdf.js hace su propia
    // petición sin el Bearer.
    const datos = new Uint8Array(await blob.value.arrayBuffer())
    if (cancelacion.signal.aborted) return
    carga = pdfjs.getDocument({ data: datos })
    documento = await carga.promise
    if (cancelacion.signal.aborted) return
    estado.value = 'listo'
    await nextTick()
    await pintar()
    observarAncho()
  } catch (fallo) {
    if (cancelacion.signal.aborted) return
    // Sin esto, un worker de otra versión se ve igual que un PDF dañado.
    console.error('No se pudo pintar el PDF de la factura', fallo)
    estado.value = 'error'
  }
})

onBeforeUnmount(() => {
  cancelacion.abort()
  clearTimeout(espera)
  observador?.disconnect()
  cancelarTareas()
  // Libera el worker: en una SPA, sin esto se acumula uno por factura abierta.
  void carga?.destroy()
})

function cancelarTareas(): void {
  for (const tarea of tareas) tarea.cancel()
  tareas = []
}

/**
 * Una página por canvas, ajustada al ancho del contenedor.
 *
 * El bitmap se multiplica por la densidad de la pantalla y el tamaño CSS se
 * divide por ella: solo el bitmap, y la hoja sale gigante; solo el CSS, y sale
 * borrosa. La densidad se topa en 2: con 3 y varias páginas Safari en iPhone
 * se queda sin memoria para el canvas y lo deja en blanco sin avisar.
 */
async function pintar(): Promise<void> {
  const caja = contenedor.value
  if (!documento || !caja) return
  const turno = ++pintado
  cancelarTareas()
  caja.replaceChildren()

  anchoPintado = caja.clientWidth
  const ancho = anchoPintado - 16 // el padding del contenedor
  const densidad = Math.min(window.devicePixelRatio || 1, 2)

  try {
    // Una página tras otra: en orden y sin N pintados a la vez en memoria.
    for (let numero = 1; numero <= documento.numPages; numero++) {
      const pagina = await documento.getPage(numero)
      if (turno !== pintado) return
      const escala = (ancho / pagina.getViewport({ scale: 1 }).width) * densidad
      const vista = pagina.getViewport({ scale: escala })

      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(vista.width)
      canvas.height = Math.floor(vista.height)
      canvas.style.width = `${vista.width / densidad}px`
      canvas.style.height = `${vista.height / densidad}px`
      caja.appendChild(canvas)

      const tarea = pagina.render({ canvas, viewport: vista })
      tareas.push(tarea)
      await tarea.promise
    }
  } catch (fallo) {
    // Un repintado (giro del teléfono) cancela al anterior: no es un error.
    if (fallo instanceof Error && fallo.name === 'RenderingCancelledException') return
    throw fallo
  }
}

/**
 * Al girar el teléfono o cambiar el ancho de la ventana se repinta. Se mira
 * solo el ancho: la barra del navegador que aparece y se esconde al hacer
 * scroll cambia el alto y no debe repintar nada.
 */
function observarAncho(): void {
  if (!contenedor.value || typeof ResizeObserver === 'undefined') return
  observador = new ResizeObserver(() => {
    clearTimeout(espera)
    espera = setTimeout(() => {
      if (contenedor.value && contenedor.value.clientWidth !== anchoPintado) {
        pintar().catch((fallo) => console.error('No se pudo repintar el PDF', fallo))
      }
    }, 200)
  })
  observador.observe(contenedor.value)
}

function archivo(): File | null {
  return blob.value ? new File([blob.value], props.nombre, { type: 'application/pdf' }) : null
}

/**
 * `navigator.share` existe en navegadores que no aceptan archivos: sin
 * preguntar antes con `canShare`, compartir falla.
 */
function aceptaArchivos(pdf: File | null): boolean {
  return !!pdf && typeof navigator.canShare === 'function' && navigator.canShare({ files: [pdf] })
}

async function compartir(): Promise<void> {
  const pdf = archivo()
  if (!pdf) return
  try {
    await navigator.share({ title: props.titulo, files: [pdf] })
  } catch (fallo) {
    // Cerrar la hoja de compartir también llega como excepción.
    if (fallo instanceof DOMException && fallo.name === 'AbortError') return
    ui.error('No se pudo compartir la factura. Descárgala y compártela desde tus archivos.')
  }
}

function descargar(): void {
  if (blob.value) guardarBlob(blob.value, props.nombre)
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('cerrar')">
    <div class="modal-sheet visor" role="dialog" aria-modal="true" :aria-label="titulo">
      <div class="modal-handle" />
      <div class="cabecera">
        <p class="modal-title">{{ titulo }}</p>
        <button type="button" class="close-x" aria-label="Cerrar" @click="emit('cerrar')">✕</button>
      </div>

      <p v-if="estado === 'cargando'" class="estado">Cargando factura…</p>
      <p v-else-if="estado === 'error'" class="estado">
        No se pudo mostrar la factura aquí. Usa el botón de descarga.
      </p>
      <div v-show="estado === 'listo'" ref="contenedor" class="hojas" />

      <div class="modal-actions">
        <button v-if="puedeCompartir" type="button" class="btn-secondary accion" @click="compartir">
          Compartir
        </button>
        <button type="button" class="btn-primary" :disabled="!blob" @click="descargar">
          Descargar PDF
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* La hoja de la factura necesita más ancho que un formulario en escritorio. */
.visor {
  max-width: 760px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cabecera {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.estado {
  margin: 0 0 12px;
  padding: 28px 12px;
  text-align: center;
  font-size: 12.5px;
  color: var(--ink);
}

/* El gris oscuro enmarca la hoja blanca y la hace leerse como documento. */
.hojas {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 8px;
  margin-bottom: 12px;
  border-radius: var(--radius-sm);
  background: var(--gris-oscuro);
}

.hojas :deep(canvas) {
  display: block;
  background: var(--white);
}

.accion {
  flex: 1;
}

.modal-actions .btn-primary:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
