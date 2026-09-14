import type { DireccionEntrega } from '@/api/tipos'

/**
 * Geocodificación inversa con Nominatim (OpenStreetMap) para llenar la
 * dirección desde el pin del mapa (HU-08).
 *
 * Es la única llamada de red fuera de `api/http.ts`, y a propósito: no va a
 * nuestra API, no lleva token y su fallo no es un error que enseñar. Si no
 * responde, el cliente sigue escribiendo a mano.
 */

const URL_NOMINATIM = 'https://nominatim.openstreetmap.org/reverse'

/** La política de uso de Nominatim: como mucho una petición por segundo. */
export const ESPACIO_MINIMO_MS = 1100
const TIEMPO_LIMITE_MS = 8000

export type CamposGeocodificados = Partial<
  Pick<DireccionEntrega, 'calle' | 'colonia' | 'cp' | 'ciudad' | 'estado'>
>

interface RespuestaNominatim {
  address?: Record<string, string | undefined>
}

/**
 * Traduce la respuesta de Nominatim a nuestros campos. Solo devuelve los que
 * vienen: un campo ausente no debe borrar lo que el cliente ya escribió.
 */
export function camposDesdeNominatim(respuesta: RespuestaNominatim): CamposGeocodificados {
  const a = respuesta.address ?? {}
  const campos: CamposGeocodificados = {}

  const calle = a.road ?? a.pedestrian ?? a.footway ?? a.path
  if (calle) campos.calle = a.house_number ? `${calle} ${a.house_number}` : calle

  const colonia = a.neighbourhood ?? a.suburb ?? a.quarter ?? a.city_district ?? a.hamlet
  if (colonia) campos.colonia = colonia

  // En zonas rurales OSM a veces trae «86000-86999» o nada: solo un CP limpio.
  const cp = a.postcode?.replace(/\s/g, '')
  if (cp && /^\d{5}$/.test(cp)) campos.cp = cp

  const ciudad = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county
  if (ciudad) campos.ciudad = ciudad

  if (a.state) campos.estado = a.state

  return campos
}

type Pedidor = (lat: number, lng: number) => Promise<RespuestaNominatim>

async function pedirNominatim(lat: number, lng: number): Promise<RespuestaNominatim> {
  const url = new URL(URL_NOMINATIM)
  url.search = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lng),
    addressdetails: '1',
    'accept-language': 'es',
  }).toString()

  const control = new AbortController()
  const limite = setTimeout(() => control.abort(), TIEMPO_LIMITE_MS)
  try {
    const respuesta = await fetch(url, { signal: control.signal })
    if (!respuesta.ok) throw new Error(`Nominatim ${respuesta.status}`)
    return (await respuesta.json()) as RespuestaNominatim
  } finally {
    clearTimeout(limite)
  }
}

/**
 * Cola de una sola plaza para no encimar peticiones.
 *
 * Arrastrar el pin cinco veces seguidas no lanza cinco consultas: la que está
 * en curso termina, las intermedias se descartan y solo sale la última, con al
 * menos `ESPACIO_MINIMO_MS` desde la anterior. `alTerminar` recibe `null` si
 * falló o si ya hay un punto más nuevo esperando (su resultado sobra).
 */
export function crearGeocodificador(
  alTerminar: (campos: CamposGeocodificados | null) => void,
  alCambiarOcupado: (ocupado: boolean) => void = () => {},
  pedir: Pedidor = pedirNominatim,
  ahora: () => number = () => Date.now(),
) {
  let enCurso = false
  let pendiente: { lat: number; lng: number } | null = null
  let ultimaSalida = -Infinity
  let espera: ReturnType<typeof setTimeout> | null = null
  let detenido = false

  async function lanzar(): Promise<void> {
    if (!pendiente || enCurso || detenido) return
    const faltan = ultimaSalida + ESPACIO_MINIMO_MS - ahora()
    if (faltan > 0) {
      if (!espera) {
        espera = setTimeout(() => {
          espera = null
          void lanzar()
        }, faltan)
      }
      return
    }

    const punto = pendiente
    pendiente = null
    enCurso = true
    ultimaSalida = ahora()
    alCambiarOcupado(true)

    let campos: CamposGeocodificados | null = null
    try {
      campos = camposDesdeNominatim(await pedir(punto.lat, punto.lng))
    } catch {
      campos = null
    }

    enCurso = false
    if (detenido) return
    // Si el pin se movió mientras tanto, esta dirección ya no es la del pin.
    if (pendiente) {
      void lanzar()
      return
    }
    alCambiarOcupado(false)
    alTerminar(campos)
  }

  return {
    buscar(lat: number, lng: number): void {
      pendiente = { lat, lng }
      alCambiarOcupado(true)
      void lanzar()
    },
    detener(): void {
      detenido = true
      pendiente = null
      if (espera) clearTimeout(espera)
      espera = null
    },
  }
}
