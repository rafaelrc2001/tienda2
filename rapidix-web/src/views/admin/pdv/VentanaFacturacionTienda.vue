<script setup lang="ts">
/**
 * PDV → Facturación: los pedidos de esta tienda —los del mostrador y los de
 * la app que se recogieron aquí— y sus facturas.
 *
 * «Por facturar» enseña los que todavía no tienen factura. Cada uno se factura
 * solo, o se palomean varios y salen juntos en una sola factura (como la
 * factura global, pero a nombre de quien la pide). El que todavía no se puede
 * facturar —sin pagar, pagado con monedero— dice por qué y no se palomea: la
 * razón la da la API.
 *
 * «Facturadas» son las que ya cubren pedidos de la tienda, con quién las creó
 * y cuándo, y su PDF y XML.
 */
import { computed, onMounted, ref } from 'vue'
import { guardarBlob, http, obtenerArchivo } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fechaHora, fechaNumerica, nombreEstadoPago } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import VisorPdfFactura from '@/components/VisorPdfFactura.vue'
import FacturarPdvModal from './FacturarPdvModal.vue'
import { nombreRol } from '../fiscal/roles'
import type { FacturaEmitida, PedidoPorFacturar, Tienda } from '@/api/tipos'

const props = defineProps<{ tienda: Tienda }>()

type Lista = 'porFacturar' | 'facturadas'

const ui = useUiStore()
const base = computed(() => `/admin/pdv/tiendas/${props.tienda.id}/facturacion`)

const lista = ref<Lista>('porFacturar')
const pedidos = ref<PedidoPorFacturar[]>([])
const facturas = ref<FacturaEmitida[]>([])
const cargando = ref(true)

/** Cambiar de lista deprisa deja respuestas viejas en el aire: gana la última. */
let peticion = 0

async function cargar(): Promise<void> {
  const numero = ++peticion
  cargando.value = true
  try {
    if (lista.value === 'porFacturar') {
      const respuesta = await http.get<PedidoPorFacturar[]>(`${base.value}/pedidos`)
      if (numero !== peticion) return
      pedidos.value = respuesta
      // Lo palomeado que ya no está (otra caja lo facturó) se suelta.
      seleccion.value = seleccion.value.filter((id) => respuesta.some((p) => p.id === id))
    } else {
      const respuesta = await http.get<FacturaEmitida[]>(`${base.value}/facturas`)
      if (numero === peticion) facturas.value = respuesta
    }
  } catch (fallo) {
    if (numero === peticion) ui.errorDeApi(fallo)
  } finally {
    if (numero === peticion) cargando.value = false
  }
}

onMounted(cargar)

function abrirLista(nueva: Lista): void {
  if (nueva === lista.value) return
  lista.value = nueva
  void cargar()
}

// ------------------------------------------------------------------
// Por facturar: uno o varios juntos
// ------------------------------------------------------------------

const seleccion = ref<string[]>([])

/** Lo que se palomea: solo los que ya se pueden facturar. */
const facturables = computed(() => pedidos.value.filter((p) => p.bloqueo === null))
const todosPalomeados = computed(
  () => facturables.value.length > 0 && seleccion.value.length === facturables.value.length,
)

function palomearTodos(marcar: boolean): void {
  seleccion.value = marcar ? facturables.value.map((p) => p.id) : []
}

/** Los pedidos de la hoja abierta. */
const aFacturar = ref<string[] | null>(null)

function facturarUno(pedido: PedidoPorFacturar): void {
  aFacturar.value = [pedido.id]
}

function facturarPalomeados(): void {
  if (seleccion.value.length > 0) aFacturar.value = [...seleccion.value]
}

function alFacturar(): void {
  aFacturar.value = null
  seleccion.value = []
  void cargar()
}

// ------------------------------------------------------------------
// Facturadas: PDF y XML
// ------------------------------------------------------------------

function ruta(f: FacturaEmitida, formato: 'pdf' | 'xml'): string {
  return `${base.value}/facturas/${f.id}/${formato}`
}

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

/** Los folios de los pedidos en una celda: pasados tres se dice cuántos más. */
function folios(f: FacturaEmitida): string {
  if (f.pedidos.length <= 3) return f.pedidos.join(', ')
  return `${f.pedidos.slice(0, 3).join(', ')} y ${f.pedidos.length - 3} más`
}
</script>

<template>
  <div class="facturacion-tienda">
    <div class="subtab-row listas" role="tablist" aria-label="Facturación">
      <button
        type="button"
        role="tab"
        class="subtab"
        :class="{ active: lista === 'porFacturar' }"
        :aria-selected="lista === 'porFacturar'"
        @click="abrirLista('porFacturar')"
      >
        Por facturar
      </button>
      <button
        type="button"
        role="tab"
        class="subtab"
        :class="{ active: lista === 'facturadas' }"
        :aria-selected="lista === 'facturadas'"
        @click="abrirLista('facturadas')"
      >
        Facturadas
      </button>
    </div>

    <SkeletonList v-if="cargando" :cantidad="3" />

    <template v-else-if="lista === 'porFacturar'">
      <div v-if="seleccion.length > 0" class="seleccion">
        <!-- El total no se suma aquí: lo da la API en la hoja «Facturar». -->
        <span class="titulo-dato">
          {{ seleccion.length }} {{ seleccion.length === 1 ? 'pedido' : 'pedidos' }} palomeados
        </span>
        <button type="button" class="btn-primary" @click="facturarPalomeados">
          {{ seleccion.length === 1 ? 'Facturar' : 'Facturar juntos en una factura' }}
        </button>
      </div>

      <div v-if="pedidos.length > 0" class="tabla-envoltorio">
        <table class="tabla lineal">
          <thead>
            <tr>
              <th class="casilla">
                <input
                  type="checkbox"
                  :checked="todosPalomeados"
                  :disabled="facturables.length === 0"
                  aria-label="Palomear todos los pedidos que se pueden facturar"
                  @change="palomearTodos(($event.target as HTMLInputElement).checked)"
                />
              </th>
              <th>Pedido</th>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Datos fiscales</th>
              <th>Pago</th>
              <th class="num">A facturar</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in pedidos"
              :key="p.id"
              :class="{ palomeado: seleccion.includes(p.id), bloqueado: p.bloqueo !== null }"
            >
              <td class="casilla">
                <input
                  v-model="seleccion"
                  type="checkbox"
                  :value="p.id"
                  :disabled="p.bloqueo !== null"
                  :aria-label="`Palomear el pedido ${p.folio}`"
                />
              </td>
              <td class="folio">{{ p.folio }}</td>
              <td class="fecha">{{ fechaNumerica(p.creadoEn) }}</td>
              <td>
                {{ p.cliente.nombre }}
                <span class="dato-chico">{{ p.cliente.telefono }}</span>
              </td>
              <td>
                <span v-if="p.cliente.conDatosFiscales" class="mini-tag con-datos">Guardados</span>
                <span v-else class="sin-datos">Sin datos</span>
              </td>
              <td>{{ nombreEstadoPago(p.estadoPago) }}</td>
              <td class="num importe">{{ dinero(p.aFacturar) }}</td>
              <td class="accion">
                <button
                  v-if="p.bloqueo === null"
                  type="button"
                  class="btn-facturar"
                  @click="facturarUno(p)"
                >
                  Facturar
                </button>
                <p v-else class="bloqueo">{{ p.bloqueo }}</p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-else class="empty-block">No hay pedidos por facturar en esta tienda.</p>
    </template>

    <template v-else>
      <div v-if="facturas.length > 0" class="tabla-envoltorio">
        <table class="tabla lineal facturadas">
          <thead>
            <tr>
              <th>Timbrada</th>
              <th>Serie-folio</th>
              <th>Pedidos</th>
              <th>RFC</th>
              <th>Nombre</th>
              <th>Emisor</th>
              <th class="num">Total</th>
              <th>Creada</th>
              <th>Creó</th>
              <th class="archivo">PDF</th>
              <th class="archivo">XML</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in facturas" :key="f.id">
              <td class="fecha">{{ fechaNumerica(f.timbradaEn) }}</td>
              <td>
                {{ f.serieFolio }}
                <span
                  v-if="f.modo === 'SIMULADO'"
                  class="mini-tag simulada"
                  title="Timbrada en modo de prueba: no tiene validez fiscal"
                >
                  Simulada
                </span>
              </td>
              <td class="folios" :title="f.pedidos.join(', ')">{{ folios(f) }}</td>
              <td class="rfc">{{ f.rfc }}</td>
              <td class="nombre" :title="f.nombre">{{ f.nombre }}</td>
              <td class="rfc" :title="f.emisor?.nombre">{{ f.emisor?.rfc ?? '—' }}</td>
              <td class="num importe">{{ dinero(f.total) }}</td>
              <td class="fecha">{{ fechaHora(f.creadaEn) }}</td>
              <td>
                <template v-if="f.creadoPor">
                  {{ f.creadoPor.nombre }}
                  <span class="dato-chico">{{ nombreRol(f.creadoPor.rol) }}</span>
                </template>
                <template v-else>—</template>
              </td>
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
          </tbody>
        </table>
      </div>

      <p v-else class="empty-block">Todavía no hay facturas de pedidos de esta tienda.</p>
    </template>

    <FacturarPdvModal
      v-if="aFacturar"
      :tienda="tienda"
      :pedido-ids="aFacturar"
      @cerrar="aFacturar = null"
      @facturado="alFacturar"
    />

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
.listas {
  margin: 0 0 12px;
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

/* Cuántos van palomeados y el botón de la factura consolidada. */
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

.seleccion .btn-primary {
  flex: 0 0 auto;
  width: auto;
  padding: 9px 14px;
}

.tabla {
  min-width: 820px;
}

.tabla.facturadas {
  min-width: 1040px;
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

.casilla input:disabled {
  cursor: default;
}

.tabla .palomeado > td {
  background: var(--cream-2);
}

.tabla .bloqueado > td {
  color: var(--muted);
}

.tabla .folio,
.tabla .fecha,
.tabla .rfc {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dato-chico {
  display: block;
  font-size: 11px;
  color: var(--muted);
}

.sin-datos {
  font-size: 12px;
  color: var(--orange-dark);
}

.mini-tag.con-datos {
  margin-left: 0;
}

.mini-tag.simulada {
  margin-left: 4px;
  color: var(--muted);
}

/* La razón social y los folios pueden ser largos: se cortan antes que ensanchar la tabla. */
.tabla .nombre,
.tabla .folios {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tabla.lineal td > .btn-facturar {
  padding: 5px 12px;
  border: 1px solid var(--verde-compra);
  border-radius: 8px;
  background: var(--verde-compra);
  color: var(--white);
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.bloqueo {
  margin: 0;
  max-width: 220px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--orange-dark);
}

.tabla .archivo {
  width: 1%;
  text-align: center;
}

.tabla .archivo .enlace {
  padding: 0;
}
</style>
