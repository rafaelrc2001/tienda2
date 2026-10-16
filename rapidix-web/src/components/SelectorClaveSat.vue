<script setup lang="ts">
/**
 * Campo para elegir una clave de los catálogos del SAT: buscador con lista
 * desplegable.
 *
 * No es un `<select>`: c_ClaveProdServ tiene 52 mil claves y c_ClaveUnidad
 * 2,400. La búsqueda la hace la API (`/admin/sat/...`) sobre el catálogo
 * oficial vigente; aquí solo se escribe, se elige y se pinta. El `v-model` es
 * la clave sola, o `''` sin clave.
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { http } from '@/api/http'
import type { ClaveProdServSat, ClaveUnidadSat } from '@/api/tipos'

const props = defineProps<{
  tipo: 'productos-servicios' | 'unidades'
  id?: string
  placeholder?: string
  invalido?: boolean
}>()

const clave = defineModel<string>({ required: true })

interface Opcion {
  clave: string
  texto: string
  /** Sinónimos del SAT o el símbolo de la unidad. */
  extra: string
}

const elegida = ref<Opcion | null>(null)
const buscando = ref(false)
const texto = ref('')
const opciones = ref<Opcion[]>([])
const abierta = ref(false)
const cargando = ref(false)
const activa = ref(-1)
const entrada = ref<HTMLInputElement | null>(null)

let espera: ReturnType<typeof setTimeout> | undefined
/** Las respuestas viejas se descartan: escribir rápido dispara varias. */
let ultimaPeticion = 0

function aOpcion(item: ClaveProdServSat | ClaveUnidadSat): Opcion {
  return 'descripcion' in item
    ? { clave: item.clave, texto: item.descripcion, extra: item.similares }
    : { clave: item.clave, texto: item.nombre, extra: item.simbolo }
}

async function consultar(q: string): Promise<Opcion[]> {
  const items = await http.get<(ClaveProdServSat | ClaveUnidadSat)[]>(`/admin/sat/${props.tipo}`, {
    query: { q },
  })
  return items.map(aOpcion)
}

/**
 * La clave que ya traía el producto llega sola; su descripción se pide a la
 * API para enseñar qué es y no solo un número.
 */
watch(
  clave,
  async (valor) => {
    if (!valor) {
      elegida.value = null
      return
    }
    if (elegida.value?.clave === valor) return
    elegida.value = { clave: valor, texto: '', extra: '' }
    try {
      const encontrada = (await consultar(valor)).find((o) => o.clave === valor)
      if (encontrada && clave.value === valor) elegida.value = encontrada
    } catch {
      // Sin descripción se sigue viendo la clave: basta para saber qué tiene.
    }
  },
  { immediate: true },
)

async function buscar(): Promise<void> {
  const q = texto.value.trim()
  const miPeticion = ++ultimaPeticion
  // 52 mil claves no se hojean: sin texto, la de producto no ofrece nada. La
  // de unidad sí, las comunes de un abarrote.
  if (!q && props.tipo === 'productos-servicios') {
    opciones.value = []
    cargando.value = false
    return
  }
  cargando.value = true
  try {
    const encontradas = await consultar(q)
    if (miPeticion !== ultimaPeticion) return
    opciones.value = encontradas
    activa.value = encontradas.length > 0 ? 0 : -1
  } catch {
    if (miPeticion === ultimaPeticion) opciones.value = []
  } finally {
    if (miPeticion === ultimaPeticion) cargando.value = false
  }
}

function alEscribir(): void {
  abierta.value = true
  clearTimeout(espera)
  espera = setTimeout(() => void buscar(), 250)
}

function empezarBusqueda(): void {
  buscando.value = true
  texto.value = ''
  opciones.value = []
  abierta.value = true
  void buscar()
  // El campo aparece en este mismo ciclo: hay que esperar a que exista.
  setTimeout(() => entrada.value?.focus())
}

function elegir(opcion: Opcion): void {
  elegida.value = opcion
  clave.value = opcion.clave
  cerrar()
}

function quitar(): void {
  elegida.value = null
  clave.value = ''
}

function cerrar(): void {
  abierta.value = false
  buscando.value = false
  texto.value = ''
  activa.value = -1
}

function alTeclear(evento: KeyboardEvent): void {
  if (evento.key === 'ArrowDown') {
    evento.preventDefault()
    abierta.value = true
    activa.value = Math.min(activa.value + 1, opciones.value.length - 1)
  } else if (evento.key === 'ArrowUp') {
    evento.preventDefault()
    activa.value = Math.max(activa.value - 1, 0)
  } else if (evento.key === 'Enter') {
    // Enter dentro del modal no debe hacer otra cosa que elegir.
    evento.preventDefault()
    const opcion = opciones.value[activa.value]
    if (opcion) elegir(opcion)
  } else if (evento.key === 'Escape') {
    evento.stopPropagation()
    cerrar()
  }
}

onBeforeUnmount(() => clearTimeout(espera))
</script>

<template>
  <div class="selector-sat">
    <!-- Con clave elegida se enseña qué es; para cambiarla se vuelve a buscar. -->
    <div v-if="elegida && !buscando" class="elegida" :class="{ 'is-invalid': invalido }">
      <button :id="id" type="button" class="elegida-texto" @click="empezarBusqueda">
        <strong>{{ elegida.clave }}</strong>
        <span>{{ elegida.texto || 'Buscando la descripción…' }}</span>
      </button>
      <button type="button" class="quitar" aria-label="Quitar la clave" @click="quitar">✕</button>
    </div>

    <template v-else>
      <input
        :id="id"
        ref="entrada"
        v-model="texto"
        class="form-input"
        :class="{ 'is-invalid': invalido }"
        type="search"
        autocomplete="off"
        role="combobox"
        :aria-expanded="abierta"
        :placeholder="placeholder"
        @input="alEscribir"
        @focus="buscando || empezarBusqueda()"
        @blur="cerrar"
        @keydown="alTeclear"
      />

      <ul v-if="abierta" class="opciones" role="listbox">
        <!-- mousedown y no click: el blur del campo cerraría la lista antes. -->
        <li
          v-for="(opcion, i) in opciones"
          :key="opcion.clave"
          role="option"
          :aria-selected="i === activa"
          :class="{ activa: i === activa }"
          @mousedown.prevent="elegir(opcion)"
          @mouseenter="activa = i"
        >
          <strong>{{ opcion.clave }}</strong> {{ opcion.texto }}
          <small v-if="opcion.extra">{{ opcion.extra }}</small>
        </li>
        <li v-if="cargando && opciones.length === 0" class="aviso">Buscando…</li>
        <li v-else-if="!texto.trim() && tipo === 'productos-servicios'" class="aviso">
          Escribe qué es el producto («botella», «refresco») o su clave.
        </li>
        <li v-else-if="!cargando && opciones.length === 0" class="aviso">
          Nada en el catálogo del SAT con «{{ texto.trim() }}».
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.selector-sat {
  position: relative;
  margin-bottom: 10px;
}

.selector-sat .form-input {
  margin-bottom: 0;
}

.elegida {
  display: flex;
  align-items: stretch;
  border: 1.5px solid var(--line);
  border-radius: 11px;
  background: var(--white);
  overflow: hidden;
}

.elegida.is-invalid {
  border-color: var(--terracotta);
}

.elegida-texto {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 8px;
  align-items: baseline;
  text-align: left;
  background: none;
  border: none;
  padding: 11px 12px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
}

.elegida-texto span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quitar {
  flex-shrink: 0;
  width: 40px;
  border: none;
  border-left: 1px solid var(--line);
  background: var(--cream);
  color: var(--muted);
  cursor: pointer;
}

.opciones {
  position: absolute;
  z-index: 5;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 260px;
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--white);
  border: 1.5px solid var(--line);
  border-radius: 11px;
  box-shadow: var(--shadow);
}

.opciones li {
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.35;
  cursor: pointer;
}

.opciones li.activa {
  background: var(--cream);
}

.opciones small {
  display: block;
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.opciones li.aviso {
  color: var(--muted);
  cursor: default;
}
</style>
