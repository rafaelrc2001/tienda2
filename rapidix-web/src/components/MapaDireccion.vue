<script setup lang="ts">
/**
 * Mapa de la dirección del perfil, con marcador arrastrable.
 *
 * Leaflet entra como dependencia de npm, no por CDN: el mockup lo cargaba de
 * unpkg y eso desaparece.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import iconoUrl from 'leaflet/dist/images/marker-icon.png'
import iconoRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import sombraUrl from 'leaflet/dist/images/marker-shadow.png'

const props = defineProps<{
  lat: number | null
  lng: number | null
}>()

const emit = defineEmits<{ (e: 'mover', coordenadas: { lat: number; lng: number }): void }>()

/** Centro por defecto cuando el perfil todavía no tiene coordenadas. */
const CENTRO_POR_DEFECTO: [number, number] = [17.9869, -92.9303] // Villahermosa
const ZOOM = 16

const contenedor = ref<HTMLDivElement | null>(null)
const buscandoUbicacion = ref(false)
const errorUbicacion = ref('')

let mapa: L.Map | null = null
let marcador: L.Marker | null = null

/**
 * Leaflet resuelve los iconos por CSS con rutas relativas que el bundler no
 * reescribe. Se le pasan explícitamente los que importa Vite.
 */
const icono = L.icon({
  iconUrl: iconoUrl,
  iconRetinaUrl: iconoRetinaUrl,
  shadowUrl: sombraUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

function posicionInicial(): [number, number] {
  return props.lat !== null && props.lng !== null ? [props.lat, props.lng] : CENTRO_POR_DEFECTO
}

onMounted(() => {
  if (!contenedor.value) return

  mapa = L.map(contenedor.value).setView(posicionInicial(), ZOOM)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  }).addTo(mapa)

  marcador = L.marker(posicionInicial(), { draggable: true, icon: icono }).addTo(mapa)
  marcador.on('dragend', () => {
    const punto = marcador?.getLatLng()
    if (punto) emit('mover', { lat: punto.lat, lng: punto.lng })
  })

  // Tocar el mapa también mueve el marcador: es más cómodo que arrastrarlo.
  mapa.on('click', (evento: L.LeafletMouseEvent) => {
    marcador?.setLatLng(evento.latlng)
    emit('mover', { lat: evento.latlng.lat, lng: evento.latlng.lng })
  })
})

// El perfil llega por API después de montar: el mapa se recoloca al recibirlo.
watch(
  () => [props.lat, props.lng] as const,
  ([lat, lng]) => {
    if (lat === null || lng === null || !mapa || !marcador) return
    const punto = marcador.getLatLng()
    if (Math.abs(punto.lat - lat) < 1e-7 && Math.abs(punto.lng - lng) < 1e-7) return
    marcador.setLatLng([lat, lng])
    mapa.setView([lat, lng], mapa.getZoom())
  },
)

onBeforeUnmount(() => {
  mapa?.remove()
  mapa = null
  marcador = null
})

/** "Usar mi ubicación actual". */
function usarUbicacionActual(): void {
  errorUbicacion.value = ''
  if (!navigator.geolocation) {
    errorUbicacion.value = 'Tu navegador no permite compartir la ubicación.'
    return
  }

  buscandoUbicacion.value = true
  navigator.geolocation.getCurrentPosition(
    (posicion) => {
      buscandoUbicacion.value = false
      const { latitude, longitude } = posicion.coords
      marcador?.setLatLng([latitude, longitude])
      mapa?.setView([latitude, longitude], ZOOM)
      emit('mover', { lat: latitude, lng: longitude })
    },
    () => {
      buscandoUbicacion.value = false
      errorUbicacion.value = 'No pudimos obtener tu ubicación. Mueve el marcador a mano.'
    },
    { enableHighAccuracy: true, timeout: 10000 },
  )
}
</script>

<template>
  <div>
    <div class="map-wrap">
      <div ref="contenedor" class="mapa" />
    </div>

    <p class="map-coords-hint">
      <template v-if="lat !== null && lng !== null">
        Ubicación fijada: {{ lat.toFixed(5) }}, {{ lng.toFixed(5) }}
      </template>
      <template v-else>
        Arrastra el marcador o toca el mapa para fijar dónde te dejamos el pedido.
      </template>
    </p>

    <button
      type="button"
      class="use-location-btn"
      :disabled="buscandoUbicacion"
      @click="usarUbicacionActual"
    >
      {{ buscandoUbicacion ? 'Buscando…' : '📍 Usar mi ubicación actual' }}
    </button>
    <p v-if="errorUbicacion" class="form-error">{{ errorUbicacion }}</p>
  </div>
</template>

<style scoped>
.map-wrap {
  border-radius: 14px;
  overflow: hidden;
  border: 1.5px solid var(--line);
  margin-bottom: 8px;
  position: relative;
}

.mapa {
  width: 100%;
  height: 190px;
  background: var(--cream-2);
}

.map-coords-hint {
  font-size: 10.5px;
  color: var(--muted);
  text-align: left;
  margin: 0 0 10px;
}

.use-location-btn {
  display: block;
  width: 100%;
  text-align: center;
  background: none;
  border: none;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  cursor: pointer;
  padding: 6px;
}
</style>
