/**
 * Capa HTTP sobre `fetch`.
 *
 * Un solo sitio donde se decide la URL base, se inyecta el Bearer y se
 * traducen los errores de Nest. Ninguna pantalla llama a `fetch` directamente.
 */

/** Clave del token en `localStorage` (SPEC 02 §3.2). */
export const CLAVE_TOKEN = 'rapidix.token'

const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '')

/**
 * Cupón que la API adjunta al bloqueo del Recetario por inactividad.
 * Llega dentro del cuerpo del 423, no en una petición aparte.
 */
export interface CuponDeBloqueo {
  code: string
  titulo: string
  mensaje: string
  expiresAt: string
}

/**
 * Error de la API ya traducido.
 *
 * Nest devuelve `message` como cadena para los errores de negocio y como
 * array cuando lo genera el `ValidationPipe`. Aquí siempre hay un `mensaje`
 * para mostrar y, si vino del pipe, la lista completa en `mensajes`.
 */
export class ErrorApi extends Error {
  /** Código HTTP. 0 si la petición ni siquiera salió (sin red). */
  readonly estado: number

  /**
   * Código de negocio de la API: `NOMBRE_REQUERIDO`, `RECETARIO_BLOQUEADO`,
   * `MINIMO_NO_ALCANZADO`… Es lo que distingue un error que la interfaz sabe
   * tratar de un fallo genérico.
   *
   * En el cuerpo de la API el campo se llama `code`; aquí se expone en
   * español como el resto de la interfaz.
   */
  readonly codigo: string | null

  /** Mensajes del `ValidationPipe`. Vacío en los errores de negocio. */
  readonly mensajes: string[]

  /** Cuerpo completo, para los errores que traen datos extra (el 423). */
  readonly cuerpo: Record<string, unknown> | null

  constructor(
    estado: number,
    mensaje: string,
    codigo: string | null = null,
    mensajes: string[] = [],
    cuerpo: Record<string, unknown> | null = null,
  ) {
    super(mensaje)
    this.name = 'ErrorApi'
    this.estado = estado
    this.codigo = codigo
    this.mensajes = mensajes
    this.cuerpo = cuerpo
  }

  /** El Recetario bloqueado por inactividad, con su cupón INACTIVITY. */
  get cuponDeBloqueo(): CuponDeBloqueo | null {
    const cupon = this.cuerpo?.cupon
    return cupon ? (cupon as CuponDeBloqueo) : null
  }

  /**
   * Reparte los mensajes del `ValidationPipe` entre los campos del formulario.
   *
   * Nest antepone el nombre de la propiedad cuando el DTO no define un
   * `message` propio ("nombre must be a string"). Los mensajes con texto
   * propio no lo llevan, así que los que no casan con ningún campo se
   * devuelven en `generales` para pintarlos arriba del formulario.
   */
  porCampo(campos: readonly string[]): { campos: Record<string, string>; generales: string[] } {
    const porCampo: Record<string, string> = {}
    const generales: string[] = []

    for (const mensaje of this.mensajes) {
      const campo = campos.find((c) => mensaje.startsWith(`${c} `))
      if (campo && !porCampo[campo]) porCampo[campo] = mensaje
      else generales.push(mensaje)
    }
    return { campos: porCampo, generales }
  }
}

/**
 * Qué hacer cuando la API responde 401.
 *
 * El módulo no importa ni el router ni el store de sesión: los pasos 9 y 11
 * registran aquí el cierre de sesión y la vuelta a `/login`. Así la capa HTTP
 * no depende de nada de arriba.
 */
type ManejadorSesionExpirada = () => void
let alExpirarSesion: ManejadorSesionExpirada = () => {}

export function registrarSesionExpirada(manejador: ManejadorSesionExpirada): void {
  alExpirarSesion = manejador
}

function leerToken(): string | null {
  try {
    return localStorage.getItem(CLAVE_TOKEN)
  } catch {
    // Navegador con el almacenamiento bloqueado: se sigue sin sesión.
    return null
  }
}

/** Saca de un cuerpo de error de Nest el mensaje, el código y la lista. */
function traducirError(
  estado: number,
  cuerpo: unknown,
): { mensaje: string; codigo: string | null; mensajes: string[] } {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return { mensaje: mensajePorEstado(estado), codigo: null, mensajes: [] }
  }

  const datos = cuerpo as Record<string, unknown>
  const codigo = typeof datos.code === 'string' ? datos.code : null
  const message = datos.message

  // El ValidationPipe manda un array; los errores de negocio, una cadena.
  if (Array.isArray(message)) {
    const mensajes = message.filter((m): m is string => typeof m === 'string')
    return { mensaje: mensajes[0] ?? mensajePorEstado(estado), codigo, mensajes }
  }
  if (typeof message === 'string' && message.trim()) {
    return { mensaje: message, codigo, mensajes: [] }
  }
  return { mensaje: mensajePorEstado(estado), codigo, mensajes: [] }
}

function mensajePorEstado(estado: number): string {
  if (estado === 0) return 'No pudimos conectar con Rapidix. Revisa tu conexión.'
  if (estado === 401) return 'Tu sesión expiró. Vuelve a entrar.'
  if (estado === 403) return 'Tu rol no tiene acceso a esta sección.'
  if (estado === 404) return 'No encontramos lo que buscabas.'
  if (estado >= 500) return 'La aplicación tuvo un problema. Inténtalo de nuevo en un momento.'
  return 'No pudimos completar la operación.'
}

export interface OpcionesPeticion {
  /** Query string, ya sin valores vacíos. */
  query?: Record<string, string | number | boolean | undefined | null>
  /** Cuerpo JSON. Se serializa aquí. */
  cuerpo?: unknown
  /**
   * Deja pasar el 401 sin cerrar la sesión. Lo usa el login: unas credenciales
   * incorrectas no son una sesión caducada.
   */
  sinCierreDeSesion?: boolean
  signal?: AbortSignal
}

function construirUrl(ruta: string, query: OpcionesPeticion['query']): string {
  const url = new URL(`${BASE}${ruta.startsWith('/') ? ruta : `/${ruta}`}`)
  for (const [clave, valor] of Object.entries(query ?? {})) {
    if (valor === undefined || valor === null || valor === '') continue
    url.searchParams.set(clave, String(valor))
  }
  return url.toString()
}

async function peticion<T>(
  metodo: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  ruta: string,
  opciones: OpcionesPeticion = {},
): Promise<T> {
  const cabeceras: Record<string, string> = {}
  const token = leerToken()
  if (token) cabeceras.Authorization = `Bearer ${token}`
  if (opciones.cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json'

  let respuesta: Response
  try {
    respuesta = await fetch(construirUrl(ruta, opciones.query), {
      method: metodo,
      headers: cabeceras,
      body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
      signal: opciones.signal,
    })
  } catch (error) {
    // Petición abortada: no es un fallo que haya que enseñar.
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ErrorApi(0, mensajePorEstado(0))
  }

  if (respuesta.status === 204) return undefined as T

  const texto = await respuesta.text()
  let cuerpo: unknown = null
  if (texto) {
    try {
      cuerpo = JSON.parse(texto)
    } catch {
      cuerpo = texto
    }
  }

  if (respuesta.ok) return cuerpo as T

  // Un 401 significa que el token ya no vale: se cierra la sesión y se vuelve
  // al login con un aviso, nunca a una pantalla en blanco.
  if (respuesta.status === 401 && !opciones.sinCierreDeSesion) {
    alExpirarSesion()
  }

  const { mensaje, codigo, mensajes } = traducirError(respuesta.status, cuerpo)
  throw new ErrorApi(
    respuesta.status,
    mensaje,
    codigo,
    mensajes,
    typeof cuerpo === 'object' && cuerpo !== null ? (cuerpo as Record<string, unknown>) : null,
  )
}

export const http = {
  get: <T>(ruta: string, opciones?: OpcionesPeticion): Promise<T> =>
    peticion<T>('GET', ruta, opciones),
  post: <T>(ruta: string, cuerpo?: unknown, opciones?: OpcionesPeticion): Promise<T> =>
    peticion<T>('POST', ruta, { ...opciones, cuerpo }),
  patch: <T>(ruta: string, cuerpo?: unknown, opciones?: OpcionesPeticion): Promise<T> =>
    peticion<T>('PATCH', ruta, { ...opciones, cuerpo }),
  put: <T>(ruta: string, cuerpo?: unknown, opciones?: OpcionesPeticion): Promise<T> =>
    peticion<T>('PUT', ruta, { ...opciones, cuerpo }),
  delete: <T>(ruta: string, opciones?: OpcionesPeticion): Promise<T> =>
    peticion<T>('DELETE', ruta, opciones),
}

/**
 * Envía un fichero como `multipart/form-data`.
 *
 * Va aparte de `http.post` porque el navegador tiene que poner el
 * `Content-Type` con su `boundary`: si se fija a mano, el backend no puede
 * separar las partes. Lo usa la importación de productos.
 */
export async function subirArchivo<T>(ruta: string, campo: string, archivo: File): Promise<T> {
  const cuerpo = new FormData()
  cuerpo.append(campo, archivo)

  const cabeceras: Record<string, string> = {}
  const token = leerToken()
  if (token) cabeceras.Authorization = `Bearer ${token}`

  let respuesta: Response
  try {
    respuesta = await fetch(construirUrl(ruta, undefined), {
      method: 'POST',
      headers: cabeceras,
      body: cuerpo,
    })
  } catch {
    throw new ErrorApi(0, mensajePorEstado(0))
  }

  const texto = await respuesta.text()
  let datos: unknown = null
  if (texto) {
    try {
      datos = JSON.parse(texto)
    } catch {
      datos = texto
    }
  }

  if (respuesta.ok) return datos as T

  if (respuesta.status === 401) alExpirarSesion()
  const { mensaje, codigo, mensajes } = traducirError(respuesta.status, datos)
  throw new ErrorApi(respuesta.status, mensaje, codigo, mensajes)
}

/**
 * Descarga un fichero que la API sirve tras el Bearer.
 *
 * Un `<a href>` normal no lleva la cabecera de autorización, así que se pide
 * con `fetch` y se entrega al navegador como blob.
 */
export async function descargarArchivo(ruta: string, nombreSugerido: string): Promise<void> {
  const cabeceras: Record<string, string> = {}
  const token = leerToken()
  if (token) cabeceras.Authorization = `Bearer ${token}`

  const respuesta = await fetch(construirUrl(ruta, undefined), { headers: cabeceras })
  if (!respuesta.ok) {
    throw new ErrorApi(respuesta.status, mensajePorEstado(respuesta.status))
  }

  const blob = await respuesta.blob()
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombreSugerido
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  URL.revokeObjectURL(url)
}

/**
 * Sube un fichero a una URL firmada de S3.
 *
 * Va fuera de `http` a propósito: no lleva Bearer ni URL base, y la respuesta
 * no es JSON. Lo usa el `<SubidorImagen>` del paso 29.
 */
export async function subirAUrlFirmada(url: string, archivo: File): Promise<void> {
  const respuesta = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': archivo.type || 'application/octet-stream' },
    body: archivo,
  })
  if (!respuesta.ok) {
    throw new ErrorApi(respuesta.status, 'No pudimos subir la imagen. Inténtalo de nuevo.')
  }
}
