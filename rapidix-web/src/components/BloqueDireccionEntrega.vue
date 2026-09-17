<script setup lang="ts">
/**
 * «Datos de entrega» del checkout (épica «Dirección de entrega», HU-02 a HU-09).
 *
 * Edita la dirección de ESTE pedido: cada cambio sube con `update:modelValue`
 * y la vista lo guarda en el borrador del carrito. El perfil solo se toca con
 * el botón «Guardar en mi perfil». El mapa y la geocodificación son ayudas: si
 * no cargan o no responden, el formulario sigue igual.
 */
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import type { DireccionEntrega, Perfil } from '@/api/tipos'
import {
  erroresDireccion,
  perfilTieneDireccion,
  resumenDireccion,
  soloDigitos,
  type CampoDireccion,
} from '@/utils/direccion'
import { crearGeocodificador } from '@/utils/geocodificacion'

/*
 * Leaflet se carga aparte y solo al abrir el bloque. Si el paquete no llega
 * (red mala, bloqueador), el componente falla en silencio y no se pinta mapa.
 */
const mapaFallo = ref(false)
const MapaDireccion = defineAsyncComponent({
  loader: () => import('@/components/MapaDireccion.vue'),
  onError: (_error, _reintentar, rendirse) => {
    mapaFallo.value = true
    rendirse()
  },
})

const props = defineProps<{
  modelValue: DireccionEntrega
  perfil: Perfil | null
  /** Marca en rojo todo lo que falte, aunque no se haya tocado. */
  marcarErrores?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', direccion: DireccionEntrega): void
  (e: 'perfil-guardado', perfil: Perfil): void
}>()

const ui = useUiStore()

/**
 * Siempre empieza cerrado y enseña el resumen (o «Toca para agregar dirección»).
 * Si al confirmar falta algo, la vista lo abre con `abrir()`.
 */
const abierto = ref(false)
/** El mapa se monta la primera vez que se abre y ya no se desmonta. */
const mapaMontado = ref(abierto.value)

function alternar(): void {
  abierto.value = !abierto.value
}

function abrir(): void {
  abierto.value = true
}

watch(abierto, (valor) => {
  if (valor) mapaMontado.value = true
})

defineExpose({ abrir })

const resumen = computed(() => resumenDireccion(props.modelValue))
const errores = computed(() => erroresDireccion(props.modelValue))

/** Un campo se pinta en rojo al salir de él, no mientras se escribe por primera vez. */
const tocados = ref(new Set<CampoDireccion>())

function errorDe(campo: CampoDireccion): string {
  if (!props.marcarErrores && !tocados.value.has(campo)) return ''
  return errores.value[campo] ?? ''
}

function tocar(campo: CampoDireccion): void {
  tocados.value.add(campo)
}

function poner(cambios: Partial<DireccionEntrega>): void {
  emit('update:modelValue', { ...props.modelValue, ...cambios })
}

function ponerTexto(campo: CampoDireccion, evento: Event): void {
  const input = evento.target as HTMLInputElement | HTMLTextAreaElement
  let valor = input.value
  if (campo === 'cp' || campo === 'telefono') {
    valor = soloDigitos(valor, campo === 'cp' ? 5 : 10)
    // Si se pegó texto con guiones, el campo enseña lo que de verdad se guarda.
    if (input.value !== valor) input.value = valor
  }
  poner({ [campo]: valor })
}

// ---- Mapa y geocodificación inversa (HU-07 a HU-09) ----

const buscandoDireccion = ref(false)

const geocodificador = crearGeocodificador(
  (campos) => {
    // Falla o sin datos: no se avisa, el cliente sigue escribiendo a mano.
    if (campos && Object.keys(campos).length > 0) poner(campos)
  },
  (ocupado) => {
    buscandoDireccion.value = ocupado
  },
)

onBeforeUnmount(() => geocodificador.detener())

/** Soltar el pin, tocar el mapa o usar la ubicación actual: mismas coordenadas, mismo autollenado. */
function moverPin(coordenadas: { lat: number; lng: number }): void {
  poner({ lat: coordenadas.lat, lng: coordenadas.lng })
  geocodificador.buscar(coordenadas.lat, coordenadas.lng)
}

// ---- Guardar en el perfil (HU-05) ----

const guardandoPerfil = ref(false)
const guardadoOk = ref(false)
let temporizadorCierre: ReturnType<typeof setTimeout> | null = null

const textoBotonPerfil = computed(() =>
  perfilTieneDireccion(props.perfil) ? 'Actualizar mi perfil' : 'Guardar en mi perfil',
)

onBeforeUnmount(() => {
  if (temporizadorCierre) clearTimeout(temporizadorCierre)
})

/**
 * Solo aquí cambia el perfil. El teléfono no viaja: el del perfil es el de
 * login y `PATCH /perfil` lo rechaza. Los campos vacíos tampoco, para no
 * borrar lo que el perfil ya tuviera.
 */
async function guardarEnPerfil(): Promise<void> {
  if (guardandoPerfil.value) return
  const d = props.modelValue
  const cuerpo: Record<string, string | number> = {}
  for (const campo of [
    'quienRecibe',
    'calle',
    'colonia',
    'cp',
    'ciudad',
    'estado',
    'referencias',
  ] as const) {
    const valor = d[campo].trim()
    if (valor) cuerpo[campo] = valor
  }
  if (d.lat !== null && d.lng !== null) {
    cuerpo.lat = d.lat
    cuerpo.lng = d.lng
  }

  guardandoPerfil.value = true
  guardadoOk.value = false
  try {
    const perfil = await http.patch<Perfil>('/perfil', cuerpo)
    emit('perfil-guardado', perfil)
    guardadoOk.value = true
    if (temporizadorCierre) clearTimeout(temporizadorCierre)
    temporizadorCierre = setTimeout(() => {
      temporizadorCierre = null
      guardadoOk.value = false
      abierto.value = false
    }, 2200)
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    guardandoPerfil.value = false
  }
}
</script>

<template>
  <section class="bloque-direccion">
    <button
      type="button"
      class="cabecera"
      :aria-expanded="abierto"
      aria-controls="datos-entrega"
      @click="alternar"
    >
      <span class="titulo">Datos de entrega</span>
      <span class="flecha" :class="{ girada: abierto }" aria-hidden="true">▾</span>
    </button>

    <p
      v-if="!abierto"
      class="resumen"
      :class="{
        vacio: !resumen,
        incompleto: resumen && Object.keys(errores).length > 0,
      }"
      @click="abrir"
    >
      {{ resumen || 'Toca para agregar dirección' }}
    </p>

    <div v-show="abierto" id="datos-entrega" class="campos">
      <label class="form-label" for="de-recibe">¿Quién recibe?</label>
      <input
        id="de-recibe"
        class="form-input campo"
        :class="{ 'is-invalid': errorDe('quienRecibe') }"
        :value="modelValue.quienRecibe"
        autocomplete="name"
        placeholder="Ej. María López"
        @input="ponerTexto('quienRecibe', $event)"
        @blur="tocar('quienRecibe')"
      />
      <p v-if="errorDe('quienRecibe')" class="form-error">
        {{ errorDe('quienRecibe') }}
      </p>

      <label class="form-label" for="de-telefono">Teléfono</label>
      <input
        id="de-telefono"
        class="form-input campo"
        :class="{ 'is-invalid': errorDe('telefono') }"
        :value="modelValue.telefono"
        type="tel"
        inputmode="numeric"
        maxlength="10"
        autocomplete="tel-national"
        placeholder="Ej. 9931234567"
        @input="ponerTexto('telefono', $event)"
        @blur="tocar('telefono')"
      />
      <p v-if="errorDe('telefono')" class="form-error">
        {{ errorDe('telefono') }}
      </p>

      <label class="form-label" for="de-calle">Calle y número</label>
      <input
        id="de-calle"
        class="form-input campo"
        :class="{ 'is-invalid': errorDe('calle') }"
        :value="modelValue.calle"
        autocomplete="address-line1"
        placeholder="Ej. Av. Gregorio Méndez 123"
        @input="ponerTexto('calle', $event)"
        @blur="tocar('calle')"
      />
      <p v-if="errorDe('calle')" class="form-error">{{ errorDe('calle') }}</p>

      <div class="form-row-2">
        <div>
          <label class="form-label" for="de-colonia">Colonia</label>
          <input
            id="de-colonia"
            class="form-input campo"
            :class="{ 'is-invalid': errorDe('colonia') }"
            :value="modelValue.colonia"
            placeholder="Ej. Centro"
            @input="ponerTexto('colonia', $event)"
            @blur="tocar('colonia')"
          />
          <p v-if="errorDe('colonia')" class="form-error">
            {{ errorDe('colonia') }}
          </p>
        </div>
        <div>
          <label class="form-label" for="de-cp">CP</label>
          <input
            id="de-cp"
            class="form-input campo"
            :class="{ 'is-invalid': errorDe('cp') }"
            :value="modelValue.cp"
            inputmode="numeric"
            maxlength="5"
            autocomplete="postal-code"
            placeholder="Ej. 86000"
            @input="ponerTexto('cp', $event)"
            @blur="tocar('cp')"
          />
          <p v-if="errorDe('cp')" class="form-error">{{ errorDe('cp') }}</p>
        </div>
      </div>

      <div class="form-row-2">
        <div>
          <label class="form-label" for="de-ciudad">Ciudad</label>
          <input
            id="de-ciudad"
            class="form-input campo"
            :class="{ 'is-invalid': errorDe('ciudad') }"
            :value="modelValue.ciudad"
            autocomplete="address-level2"
            placeholder="Ej. Villahermosa"
            @input="ponerTexto('ciudad', $event)"
            @blur="tocar('ciudad')"
          />
          <p v-if="errorDe('ciudad')" class="form-error">
            {{ errorDe('ciudad') }}
          </p>
        </div>
        <div>
          <label class="form-label" for="de-estado">Estado</label>
          <input
            id="de-estado"
            class="form-input campo"
            :value="modelValue.estado"
            autocomplete="address-level1"
            placeholder="Ej. Tabasco"
            @input="ponerTexto('estado', $event)"
          />
        </div>
      </div>

      <label class="form-label" for="de-referencias">Referencias</label>
      <textarea
        id="de-referencias"
        class="form-textarea campo"
        :value="modelValue.referencias"
        rows="2"
        placeholder="Portón verde, entre dos tiendas…"
        @input="ponerTexto('referencias', $event)"
      />

      <!-- El pin es de este pedido: moverlo no cambia las coordenadas del perfil. -->
      <div v-if="mapaMontado && !mapaFallo" class="mapa">
        <MapaDireccion :lat="modelValue.lat" :lng="modelValue.lng" @mover="moverPin" />
        <p v-if="buscandoDireccion" class="buscando" aria-live="polite">buscando dirección…</p>
      </div>

      <div class="guardar-perfil">
        <p v-if="guardadoOk" class="guardado" role="status">✓ Dirección guardada</p>
        <button
          v-else
          type="button"
          class="btn-secondary boton-perfil"
          :disabled="guardandoPerfil"
          @click="guardarEnPerfil"
        >
          {{ guardandoPerfil ? 'Guardando…' : textoBotonPerfil }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: none;
  border: none;
  padding: 2px 0;
  cursor: pointer;
  text-align: left;
}

/* Mismo subtítulo en mayúsculas que el resto de secciones del resumen. */
.titulo {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

/* Flecha grande y con área de toque de 36px: con 14px pasaba desapercibida en móvil. */
.flecha {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  font-size: 26px;
  line-height: 1;
  color: var(--ink);
  transition: transform 0.15s ease;
}

.flecha.girada {
  transform: rotate(180deg);
}

.resumen {
  font-size: 13.5px;
  color: var(--ink);
  margin: 4px 0 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.resumen.vacio {
  color: var(--terracotta-dark);
  font-weight: 700;
}

.resumen.incompleto {
  color: var(--terracotta-dark);
}

/*
 * Fondo crema alrededor de la captura: los campos son blancos y la tarjeta del
 * resumen también, así que sin esto no se veía dónde se escribe.
 */
.campos {
  margin-top: 8px;
  background: var(--cream);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 10px 12px;
}

.campos .form-label {
  font-size: 12px;
  margin-bottom: 5px;
}

/* 16px o más: por debajo, Safari en iPhone hace zoom al enfocar el campo. */
.campo {
  font-size: 16px;
}

.campo::placeholder {
  font-size: 13.5px;
}

.mapa {
  margin-top: 4px;
}

.buscando {
  font-size: 11px;
  color: var(--sage);
  margin: -4px 0 6px;
}

.guardar-perfil {
  margin-top: 6px;
}

.boton-perfil {
  width: 100%;
}

.guardado {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13px;
  color: var(--verde-dark);
  text-align: center;
  margin: 0;
  padding: 8px 0;
}
</style>
