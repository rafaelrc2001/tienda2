/**
 * TEMPORAL — sonda para depurar en Safari iOS el importe encimado de la barra
 * «Comprar ahora» (salía «Comprar ahora: 5» o «Comprar aho$580.00» hasta
 * volver a tocar la pantalla).
 *
 * Cada vez que cambia el importe se toma una foto del botón en varios momentos
 * (al instante, en el siguiente frame, a los 300 ms y a los 1.5 s) y se manda a
 * `POST /diagnostico-ui`, que la guarda en la tabla `diagnostico_ui`. Con eso se
 * distingue entre:
 *
 *  - **Fallo de maquetación**: las cajas del DOM ya se encima (el rect del
 *    importe empieza antes de que acabe «Comprar ahora:»), o el botón desborda.
 *  - **Fallo de pintado**: las cajas están bien pero la pantalla no; entonces
 *    las medidas salen correctas y lo que falla es el repintado de WebKit.
 *  - **Algo lo tapa**: `elementFromPoint` en varios puntos del botón devuelve
 *    otro elemento.
 *  - **La fuente**: si `document.fonts` aún estaba cargando cuando se midió.
 *
 * Se quita entera (este archivo, su uso en TiendaView y el módulo de la API)
 * cuando se cierre el caso.
 */
import { http } from '@/api/http'

/** Tope por visita: que un carrito largo no inunde la tabla. */
const MAX_EVENTOS_POR_SESION = 300
const INTERVALO_ENVIO_MS = 3000
const MAX_POR_LOTE = 40

interface Evento {
  evento: string
  datos: Record<string, unknown>
}

const sesion = generarId()
let pendientes: Evento[] = []
let enviados = 0
let temporizador: ReturnType<typeof setTimeout> | null = null
let escuchasGlobales = false

function generarId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  } catch {
    // Safari viejo sin randomUUID: se cae al aleatorio de abajo.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function rect(el: Element | null): Record<string, number> | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return {
    x: redondear(r.left),
    y: redondear(r.top),
    w: redondear(r.width),
    h: redondear(r.height),
    right: redondear(r.right),
  }
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100
}

/** Cajas de cada línea del texto suelto «Comprar ahora:» (sin el importe). */
function cajasDelTexto(boton: HTMLElement): Record<string, number>[] {
  // El texto va dentro de `.comprar-texto` (el bloque que se recrea con cada importe).
  const contenedor = boton.querySelector('.comprar-texto') ?? boton
  const nodo = Array.from(contenedor.childNodes).find(
    (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
  )
  if (!nodo) return []
  const rango = document.createRange()
  rango.selectNodeContents(nodo)
  return Array.from(rango.getClientRects()).map((r) => ({
    x: redondear(r.left),
    y: redondear(r.top),
    w: redondear(r.width),
    right: redondear(r.right),
  }))
}

/** Qué elemento hay de verdad en varios puntos del botón (¿algo lo tapa?). */
function quienEstaEncima(boton: HTMLElement): Record<string, string> {
  const r = boton.getBoundingClientRect()
  const y = r.top + r.height / 2
  const puntos: Record<string, number> = {
    izq: r.left + r.width * 0.15,
    centro: r.left + r.width * 0.5,
    der: r.left + r.width * 0.85,
  }
  const salida: Record<string, string> = {}
  for (const [nombre, x] of Object.entries(puntos)) {
    const el = document.elementFromPoint(x, y)
    salida[nombre] = el
      ? `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ').join('.') : ''}`
      : 'null'
  }
  return salida
}

/** Foto completa del botón en este instante. */
export function medirBoton(boton: HTMLElement | null): Record<string, unknown> {
  if (!boton) return { boton: null }
  const importe = boton.querySelector('.amt')
  const barra = boton.closest('.barra-compra')
  const pantalla = boton.closest('.app-screen') ?? document.querySelector('.app-screen')
  const estilo = getComputedStyle(boton)
  const estiloBarra = barra ? getComputedStyle(barra) : null
  const textos = cajasDelTexto(boton)
  const rImporte = rect(importe)
  const ultimaLinea = textos[textos.length - 1]

  return {
    texto: boton.textContent?.replace(/\s+/g, ' ').trim(),
    importeTexto: importe?.textContent?.trim() ?? null,
    boton: rect(boton),
    importe: rImporte,
    lineasTexto: textos,
    lineasImporte: importe ? importe.getClientRects().length : 0,
    // Si el importe empieza antes de que termine «Comprar ahora:» en la misma
    // línea, el encimado ya está en el layout y no es solo pintado.
    encimadoEnLayout:
      !!rImporte &&
      !!ultimaLinea &&
      Math.abs(ultimaLinea.y - rImporte.y) < 4 &&
      rImporte.x < ultimaLinea.right - 0.5,
    desborda: {
      scrollW: boton.scrollWidth,
      clientW: boton.clientWidth,
      scrollH: boton.scrollHeight,
      clientH: boton.clientHeight,
    },
    encima: quienEstaEncima(boton),
    estilo: {
      fuente: estilo.fontFamily,
      tam: estilo.fontSize,
      peso: estilo.fontWeight,
      whiteSpace: estilo.whiteSpace,
      textAlign: estilo.textAlign,
      transformBarra: estiloBarra?.transform ?? null,
      positionBarra: estiloBarra?.position ?? null,
    },
    fuentes: {
      estado: document.fonts?.status ?? 'sin-api',
      // ¿La fuente del botón ya está lista? Si no, Safari mide con la de reserva.
      lista: comprobarFuente(estilo),
    },
    viewport: {
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      vvW: window.visualViewport ? redondear(window.visualViewport.width) : null,
      vvH: window.visualViewport ? redondear(window.visualViewport.height) : null,
      vvEscala: window.visualViewport?.scale ?? null,
      dpr: window.devicePixelRatio,
    },
    scrollPantalla: pantalla ? pantalla.scrollTop : null,
    visible: document.visibilityState,
    t: Math.round(performance.now()),
  }
}

function comprobarFuente(estilo: CSSStyleDeclaration): boolean | string {
  try {
    if (!document.fonts?.check) return 'sin-api'
    return document.fonts.check(`${estilo.fontWeight} ${estilo.fontSize} ${estilo.fontFamily}`)
  } catch (e) {
    return `error: ${String(e)}`
  }
}

export function registrar(evento: string, datos: Record<string, unknown>): void {
  if (enviados + pendientes.length >= MAX_EVENTOS_POR_SESION) return
  pendientes.push({ evento, datos })
  if (pendientes.length >= MAX_POR_LOTE) void enviar()
  else if (!temporizador) temporizador = setTimeout(() => void enviar(), INTERVALO_ENVIO_MS)
}

async function enviar(): Promise<void> {
  if (temporizador) {
    clearTimeout(temporizador)
    temporizador = null
  }
  if (pendientes.length === 0) return
  const lote = pendientes.slice(0, MAX_POR_LOTE)
  pendientes = pendientes.slice(MAX_POR_LOTE)
  enviados += lote.length
  try {
    // sinCierreDeSesion: un token vencido no debe sacar al cliente por un log.
    await http.post('/diagnostico-ui', { sesion, eventos: lote }, { sinCierreDeSesion: true })
  } catch {
    // La telemetría nunca molesta: si falla, se pierde y ya.
  }
  if (pendientes.length > 0) void enviar()
}

/**
 * Mide el botón tras un cambio del importe en varios momentos: si la foto del
 * instante y la de 1.5 s difieren sin que nadie toque, es un fallo de layout
 * que se corrige solo; si todas salen bien, el fallo es de pintado.
 */
export function medirTrasCambio(
  boton: () => HTMLElement | null,
  contexto: Record<string, unknown>,
): void {
  const tomar = (momento: string): void =>
    registrar('cambio-importe', { momento, ...contexto, ...medirBoton(boton()) })
  tomar('nextTick')
  requestAnimationFrame(() => {
    tomar('raf')
    requestAnimationFrame(() => tomar('raf2'))
  })
  setTimeout(() => tomar('300ms'), 300)
  setTimeout(() => tomar('1500ms'), 1500)
}

/** Eventos del navegador que pueden explicar un repintado tardío. */
export function escucharGlobales(boton: () => HTMLElement | null): void {
  if (escuchasGlobales) return
  escuchasGlobales = true
  registrar('inicio', {
    ...medirBoton(boton()),
    url: location.pathname,
    standalone: (navigator as Navigator & { standalone?: boolean }).standalone ?? null,
  })
  document.fonts?.addEventListener?.('loadingdone', () =>
    registrar('fuentes-cargadas', medirBoton(boton())),
  )
  window.visualViewport?.addEventListener('resize', () =>
    registrar('viewport-resize', medirBoton(boton())),
  )
  window.addEventListener('pageshow', (e) =>
    registrar('pageshow', { persisted: e.persisted, ...medirBoton(boton()) }),
  )
  document.addEventListener('visibilitychange', () => {
    registrar('visibilidad', medirBoton(boton()))
    if (document.visibilityState === 'hidden') void enviar()
  })
}

/** Al salir de la Tienda se manda lo que quede. */
export function vaciar(): void {
  void enviar()
}
