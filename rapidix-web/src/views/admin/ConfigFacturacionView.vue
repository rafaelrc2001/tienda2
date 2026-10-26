<script setup lang="ts">
/**
 * Configuración → Fiscal → Facturación: todas las facturas que emitió el
 * negocio, las de los pedidos y las globales, mes por mes.
 *
 * El selector solo ofrece los meses que tienen facturas (los corta la API en
 * la hora de México). El PDF se abre en el visor, que ya trae compartir y
 * descargar; el XML se descarga directo.
 *
 * Palomeando facturas se bajan o se comparten juntos su PDF y su XML. En el
 * iPhone, compartir es la forma de guardarlos («Guardar en Archivos»): Safari
 * no baja varios archivos seguidos.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { guardarBlob, http, obtenerArchivo } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import VisorPdfFactura from '@/components/VisorPdfFactura.vue'
import PestanasFiscal from './fiscal/PestanasFiscal.vue'
import type { FacturaEmitida, PeriodoFacturas } from '@/api/tipos'

const ui = useUiStore()

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

const BASE = '/admin/configuracion/facturas'

function nombrePeriodo(p: { anio: number; mes: number }): string {
  return `${MESES[p.mes - 1]} ${p.anio}`
}

function clave(p: { anio: number; mes: number }): string {
  return `${p.anio}-${String(p.mes).padStart(2, '0')}`
}

/** `2026-10-23T…` → `23-oct-2026`: el día en que se timbró, en la hora de México. */
function fecha(iso: string): string {
  const dia = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
  const [anio, mes, d] = dia.split('-').map(Number)
  return `${String(d).padStart(2, '0')}-${MESES[mes - 1].slice(0, 3).toLowerCase()}-${anio}`
}

function ruta(f: FacturaEmitida, formato: 'pdf' | 'xml'): string {
  return `${BASE}/${f.tipo === 'GLOBAL' ? 'global' : 'pedido'}/${f.id}/${formato}`
}

const periodos = ref<PeriodoFacturas[]>([])
const periodo = ref('')
const facturas = ref<FacturaEmitida[]>([])
const cargando = ref(true)
const cargandoMes = ref(false)

onMounted(async () => {
  try {
    periodos.value = await http.get<PeriodoFacturas[]>(`${BASE}/periodos`)
    if (periodos.value[0]) {
      periodo.value = clave(periodos.value[0])
      await cargarMes()
    }
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
})

/** Cambiar de mes deprisa deja respuestas viejas en el aire: gana la última. */
let peticion = 0

async function cargarMes(): Promise<void> {
  const numero = ++peticion
  const [anio, mes] = periodo.value.split('-').map(Number)
  seleccion.value = []
  cargandoMes.value = true
  try {
    const respuesta = await http.get<FacturaEmitida[]>(BASE, { query: { anio, mes } })
    if (numero === peticion) facturas.value = respuesta
  } catch (fallo) {
    if (numero === peticion) ui.errorDeApi(fallo)
  } finally {
    if (numero === peticion) cargandoMes.value = false
  }
}

const elegido = computed(() => periodos.value.find((p) => clave(p) === periodo.value) ?? null)

// ------------------------------------------------------------------
// PDF y XML de una sola factura
// ------------------------------------------------------------------

const visor = ref<FacturaEmitida | null>(null)
const descargando = ref<string | null>(null)

async function descargarXml(f: FacturaEmitida): Promise<void> {
  if (descargando.value) return
  descargando.value = f.id
  try {
    guardarBlob(await obtenerArchivo(ruta(f, 'xml')), `${f.archivo}.xml`)
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    descargando.value = null
  }
}

// ------------------------------------------------------------------
// Palomeadas: descargar o compartir sus PDF y XML juntos
// ------------------------------------------------------------------

const seleccion = ref<string[]>([])
const trabajando = ref<'descargar' | 'compartir' | null>(null)

const palomeadas = computed(() => facturas.value.filter((f) => seleccion.value.includes(f.id)))
const todasPalomeadas = computed(
  () => facturas.value.length > 0 && seleccion.value.length === facturas.value.length,
)

function palomearTodas(marcar: boolean): void {
  seleccion.value = marcar ? facturas.value.map((f) => f.id) : []
}

/** Solo se ofrece «Compartir» donde el navegador sabe mandar archivos. */
const puedeCompartir = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'

/**
 * Los archivos se bajan al palomear y no al tocar «Compartir»: el navegador
 * solo abre la hoja de compartir justo después del toque, y si antes se espera
 * a la red (varias facturas, red lenta) la rechaza y nunca sale WhatsApp.
 */
const listos = shallowRef<File[] | null>(null)
const preparando = ref(false)

/** El PDF y el XML de cada factura, guardados mientras siga palomeada. */
const porFactura = new Map<string, Promise<File[]>>()

async function bajarFactura(f: FacturaEmitida): Promise<File[]> {
  const archivos: File[] = []
  for (const formato of ['pdf', 'xml'] as const) {
    const blob = await obtenerArchivo(ruta(f, formato))
    archivos.push(
      new File([blob], `${f.archivo}.${formato}`, {
        type: formato === 'pdf' ? 'application/pdf' : 'application/xml',
      }),
    )
  }
  return archivos
}

function archivosDe(f: FacturaEmitida): Promise<File[]> {
  let promesa = porFactura.get(f.id)
  if (!promesa) {
    promesa = bajarFactura(f)
    porFactura.set(f.id, promesa)
    // Una bajada fallida no se queda guardada: el siguiente intento la repite.
    promesa.catch(() => porFactura.delete(f.id))
  }
  return promesa
}

/** Palomear rápido deja bajadas en el aire: gana la última selección. */
let turnoPreparar = 0

/** Una factura tras otra para no cargar la API; las ya bajadas no se repiten. */
async function preparar(): Promise<void> {
  const turno = ++turnoPreparar
  const elegidas = palomeadas.value
  for (const id of porFactura.keys()) {
    if (!seleccion.value.includes(id)) porFactura.delete(id)
  }
  listos.value = null
  if (elegidas.length === 0) {
    preparando.value = false
    return
  }
  preparando.value = true
  try {
    const archivos: File[] = []
    for (const f of elegidas) archivos.push(...(await archivosDe(f)))
    if (turno === turnoPreparar) listos.value = archivos
  } catch (fallo) {
    if (turno === turnoPreparar) ui.errorDeApi(fallo)
  } finally {
    if (turno === turnoPreparar) preparando.value = false
  }
}

// `deep`: las casillas con v-model meten y sacan del mismo arreglo.
watch(seleccion, preparar, { deep: true })

async function descargar(): Promise<void> {
  if (trabajando.value || seleccion.value.length === 0) return
  trabajando.value = 'descargar'
  try {
    if (!listos.value) await preparar()
    const archivos = listos.value ?? []
    for (const archivo of archivos) {
      guardarBlob(archivo, archivo.name)
      // Sin una pausa, Chrome se queda con la primera descarga y tira las demás.
      await new Promise((r) => setTimeout(r, 250))
    }
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    trabajando.value = null
  }
}

async function compartir(): Promise<void> {
  if (trabajando.value || seleccion.value.length === 0) return
  // Nada de esperas antes de `navigator.share`: con una, el toque ya no cuenta.
  if (!listos.value) {
    // Solo pasa si la bajada falló; se reintenta y se toca de nuevo.
    if (!preparando.value) void preparar()
    return
  }
  trabajando.value = 'compartir'

  // Chrome en Android no comparte XML: se mandan los que acepte y se avisa.
  const archivos = listos.value.filter((a) => navigator.canShare({ files: [a] }))
  if (archivos.length === 0) {
    trabajando.value = null
    ui.error(
      'Este navegador no deja compartir archivos. Descárgalos y compártelos desde tus archivos.',
    )
    return
  }
  try {
    const cuantas = palomeadas.value.length
    await navigator.share({
      title: cuantas === 1 ? `Factura ${palomeadas.value[0].serieFolio}` : `${cuantas} facturas`,
      files: archivos,
    })
    if (archivos.length < listos.value.length) {
      ui.info('Este navegador no deja compartir los XML: descárgalos con «Descargar».')
    }
  } catch (fallo) {
    if (fallo instanceof DOMException && fallo.name === 'AbortError') return
    ui.error('No se pudieron compartir. Descárgalos y compártelos desde tus archivos.')
  } finally {
    trabajando.value = null
  }
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin/configuracion" class="admin-back-inline">
      ← Volver a Configuración
    </RouterLink>

    <PestanasFiscal activa="facturacion" />

    <SkeletonList v-if="cargando" :cantidad="3" />

    <p v-else-if="periodos.length === 0" class="empty-block">
      Todavía no se ha emitido ninguna factura.
    </p>

    <template v-else>
      <!-- Bloque crema y campo blanco: se ve dónde se elige. -->
      <div class="filtros">
        <label class="form-label" for="facturas-periodo">Periodo</label>
        <select id="facturas-periodo" v-model="periodo" class="form-input" @change="cargarMes">
          <option v-for="p in periodos" :key="clave(p)" :value="clave(p)">
            {{ nombrePeriodo(p) }} · {{ p.cantidad }}
            {{ p.cantidad === 1 ? 'factura' : 'facturas' }}
          </option>
        </select>
      </div>

      <!-- Lo palomeado y lo que se hace con sus archivos. -->
      <div v-if="seleccion.length > 0" class="seleccion">
        <span class="titulo-dato">
          {{ seleccion.length }} {{ seleccion.length === 1 ? 'factura' : 'facturas' }} · PDF y XML
        </span>
        <div class="acciones-seleccion">
          <button
            type="button"
            class="btn-secondary"
            :disabled="trabajando !== null"
            @click="descargar"
          >
            {{ trabajando === 'descargar' ? 'Descargando…' : 'Descargar' }}
          </button>
          <button
            v-if="puedeCompartir"
            type="button"
            class="btn-primary"
            :disabled="trabajando !== null || preparando"
            @click="compartir"
          >
            {{ preparando ? 'Preparando…' : 'Compartir' }}
          </button>
        </div>
      </div>

      <SkeletonList v-if="cargandoMes && facturas.length === 0" :cantidad="3" />

      <div v-else class="tabla-envoltorio">
        <table class="tabla lineal">
          <thead>
            <tr>
              <th class="casilla">
                <input
                  type="checkbox"
                  :checked="todasPalomeadas"
                  :disabled="facturas.length === 0"
                  aria-label="Palomear todas las facturas del mes"
                  @change="palomearTodas(($event.target as HTMLInputElement).checked)"
                />
              </th>
              <th>Fecha</th>
              <th>Serie-folio</th>
              <th>RFC</th>
              <th>Nombre</th>
              <th>Método pago</th>
              <th class="num">Total</th>
              <th class="archivo">PDF</th>
              <th class="archivo">XML</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in facturas" :key="f.id" :class="{ palomeado: seleccion.includes(f.id) }">
              <td class="casilla">
                <input
                  v-model="seleccion"
                  type="checkbox"
                  :value="f.id"
                  :aria-label="`Palomear la factura ${f.serieFolio}`"
                />
              </td>
              <td class="fecha">{{ fecha(f.timbradaEn) }}</td>
              <td>
                {{ f.serieFolio }}
                <span v-if="f.tipo === 'GLOBAL'" class="mini-tag" title="Factura global">
                  Global
                </span>
                <span
                  v-if="f.modo === 'SIMULADO'"
                  class="mini-tag simulada"
                  title="Timbrada en modo de prueba: no tiene validez fiscal"
                >
                  Simulada
                </span>
              </td>
              <td class="rfc">{{ f.rfc }}</td>
              <td class="nombre" :title="f.nombre">{{ f.nombre }}</td>
              <td :title="f.formaPago.nombre">
                {{ f.formaPago.clave
                }}<template v-if="f.formaPago.nombre"> · {{ f.formaPago.nombre }}</template>
              </td>
              <td class="num importe">{{ dinero(f.total) }}</td>
              <td class="archivo">
                <button type="button" class="enlace" @click="visor = f">PDF</button>
              </td>
              <td class="archivo">
                <button
                  type="button"
                  class="enlace"
                  :disabled="descargando !== null"
                  @click="descargarXml(f)"
                >
                  {{ descargando === f.id ? '…' : 'XML' }}
                </button>
              </td>
            </tr>
            <tr v-if="facturas.length === 0 && !cargandoMes">
              <td colspan="9" class="vacio">
                Sin facturas en {{ elegido ? nombrePeriodo(elegido) : 'este mes' }}.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <VisorPdfFactura
      v-if="visor"
      :ruta="ruta(visor, 'pdf')"
      :nombre="`${visor.archivo}.pdf`"
      :titulo="`🧾 Factura ${visor.serieFolio}`"
      @cerrar="visor = null"
    />
  </div>
</template>

<style scoped>
.pantalla {
  padding: 12px 18px 0;
}

.admin-back-inline {
  display: inline-block;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  padding: 0 0 14px;
  text-decoration: none;
}

.filtros {
  background: var(--cream-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  margin-bottom: 12px;
}

.filtros .form-label {
  margin-top: 0;
}

.filtros .form-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  background: var(--white);
}

.titulo-dato {
  display: block;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--muted);
}

/* Cuántas van palomeadas y sus dos botones, encima de la tabla. */
.seleccion {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  background: var(--cream-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  margin-bottom: 12px;
}

.acciones-seleccion {
  display: flex;
  gap: 8px;
}

.acciones-seleccion button {
  flex: 0 0 auto;
  width: auto;
  padding: 9px 14px;
}

.tabla {
  min-width: 820px;
}

.tabla .casilla {
  width: 1%;
  text-align: center;
}

.casilla input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--terracotta);
  cursor: pointer;
}

.tabla .palomeado > td {
  background: var(--cream-2);
}

.tabla .fecha,
.tabla .rfc {
  font-variant-numeric: tabular-nums;
}

/* La razón social puede ser larga: se corta antes que ensanchar la tabla. */
.tabla .nombre {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tabla .archivo {
  width: 1%;
  text-align: center;
}

.tabla .archivo .enlace {
  padding: 0;
}

.mini-tag {
  margin-left: 4px;
}

.mini-tag.simulada {
  color: var(--muted);
}

.vacio {
  color: var(--muted);
  text-align: center;
}
</style>
