<script setup lang="ts">
/**
 * PDV → Inventario: lo que bodega le mandó a la tienda y lo que la tienda tiene.
 *
 * Es el «recolectar» de Rutas con la tienda en el papel del camión: bodega
 * arma la transferencia (Productos → Movimientos) y aquí se **acepta**. Al
 * aceptarla la mercancía sale del físico de bodega y entra al inventario de la
 * tienda, las dos cosas o ninguna.
 *
 * El inventario es de solo lectura por lo mismo que el de bodega: sube con las
 * transferencias y baja con lo que el punto de venta entrega. Entre que un
 * pedido se confirma y se entrega sus piezas siguen en el anaquel pero ya
 * están comprometidas: por eso la tabla separa inventario físico y apto para venta (ATP).
 */
import { computed, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { fechaHora } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import type { ExistenciaTienda, Tienda, Transferencia } from '@/api/tipos'
import {
  ordenarInventarioTienda,
  siguienteOrdenInventarioTienda,
  type ColumnaInventarioTienda,
  type OrdenInventarioTienda,
} from './ordenInventarioTienda'

/** La tienda desde la que se mira el PDV: todo lo de esta pestaña es suyo. */
const props = defineProps<{ tienda: Tienda }>()

const ui = useUiStore()

const pendientes = ref<Transferencia[]>([])
const existencias = ref<ExistenciaTienda[]>([])
const cargando = ref(true)
const error = ref('')
/** La transferencia que se está aceptando: apaga su botón contra la doble pulsación. */
const aceptando = ref('')
const busqueda = ref('')

/** Se queda al recargar tras aceptar una transferencia: quien ordena suele querer verlo así. */
const orden = ref<OrdenInventarioTienda | null>(null)

/**
 * `\n` parte el encabezado en dos renglones y el guion suave deja cortar
 * «Comprometido»: así las cuatro columnas caben en el teléfono.
 */
const COLUMNAS: {
  columna: ColumnaInventarioTienda
  titulo: string
  /** Para el `title` del botón: «Ordenar por …». */
  nombre: string
  clase?: string
}[] = [
  { columna: 'producto', titulo: 'Producto', nombre: 'producto' },
  { columna: 'fisico', titulo: 'Inv.\nfísico', nombre: 'inventario físico', clase: 'num' },
  {
    columna: 'comprometido',
    titulo: 'Compro­metido',
    nombre: 'comprometido',
    clase: 'num',
  },
  { columna: 'disponible', titulo: 'Apt.\nventa', nombre: 'apto para venta', clase: 'num' },
]

function ordenarPor(columna: ColumnaInventarioTienda): void {
  orden.value = siguienteOrdenInventarioTienda(orden.value, columna)
}

/** Para lectores de pantalla: cómo está ordenada cada columna. */
function ariaSort(columna: ColumnaInventarioTienda): 'ascending' | 'descending' | 'none' {
  if (orden.value?.columna !== columna) return 'none'
  return orden.value.direccion === 'asc' ? 'ascending' : 'descending'
}

const visibles = computed<ExistenciaTienda[]>(() => {
  const termino = busqueda.value.trim().toLowerCase()
  const filtradas = termino
    ? existencias.value.filter((e) => `${e.nombre} ${e.categoria}`.toLowerCase().includes(termino))
    : existencias.value
  return ordenarInventarioTienda(filtradas, orden.value)
})

onMounted(cargar)

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    const id = props.tienda.id
    const [porAceptar, inventario] = await Promise.all([
      http.get<Transferencia[]>(`/admin/pdv/transferencias?tiendaId=${id}&estado=PENDIENTE`),
      http.get<ExistenciaTienda[]>(`/admin/pdv/tiendas/${id}/inventario`),
    ])
    pendientes.value = porAceptar
    existencias.value = inventario
  } catch (fallo) {
    error.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos cargar el inventario.'
  } finally {
    cargando.value = false
  }
}

async function aceptar(transferencia: Transferencia): Promise<void> {
  if (
    !confirm(
      `¿Aceptar la transferencia ${transferencia.folio}? Sus ${transferencia.piezas} pieza(s) ` +
        `entran al inventario de ${transferencia.tienda.nombre}.`,
    )
  ) {
    return
  }
  aceptando.value = transferencia.id
  try {
    await http.post(`/admin/pdv/transferencias/${transferencia.id}/aceptar`)
    ui.exito(`Transferencia ${transferencia.folio} aceptada`)
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    aceptando.value = ''
    // También tras un fallo: si otro ya la aceptó o bodega la canceló, deja de verse.
    await cargar()
  }
}
</script>

<template>
  <div class="ventana-inventario-tienda">
    <p v-if="error" class="form-error">{{ error }}</p>

    <SkeletonList v-if="cargando" :cantidad="3" />

    <template v-else>
      <h4>Transferencias por aceptar</h4>
      <!-- Una caja por transferencia: arriba quién y cuándo con su botón, y
           abajo un renglón por producto. En una sola fila los productos se
           amontonaban en una celda y no se distinguía uno de otro. -->
      <template v-if="pendientes.length > 0">
        <div v-for="t in pendientes" :key="t.id" class="tabla-envoltorio transferencia">
          <div class="encabezado">
            <div>
              <span class="folio">{{ t.folio }}</span>
              <span class="sub">{{ fechaHora(t.creadoEn) }} · Envía {{ t.empleado }}</span>
              <span v-if="t.observaciones" class="sub">{{ t.observaciones }}</span>
            </div>
            <button
              type="button"
              class="btn-primary aceptar"
              :disabled="aceptando !== ''"
              @click="aceptar(t)"
            >
              {{ aceptando === t.id ? 'Aceptando…' : 'Aceptar' }}
            </button>
          </div>
          <table class="tabla">
            <thead>
              <tr>
                <th>Producto</th>
                <th class="num">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in t.lineas" :key="l.productoId">
                <td>{{ l.producto }}</td>
                <td class="num">{{ l.cantidad }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <p v-else class="empty-block">No hay transferencias por aceptar.</p>

      <h4>Inventario de la tienda</h4>
      <input
        v-if="existencias.length > 0"
        v-model="busqueda"
        class="form-input"
        type="search"
        placeholder="Buscar en el inventario…"
      />
      <!-- Mismos encabezados que Productos → Inventario (bodega): «Inv. físico»
           y «Apt. venta». «Apt. venta» es el ATP: lo que todavía se puede
           prometer y el número para decidir si se resurte. El físico solo engaña
           porque incluye piezas comprometidas en pedidos sin entregar; vuelven a
           estar aptas si el pedido se cancela. El grupo va bajo el nombre para
           que las cuatro columnas quepan en el teléfono. -->
      <div v-if="visibles.length > 0" class="tabla-envoltorio">
        <table class="tabla">
          <thead>
            <!-- Tocar un encabezado ordena: ascendente, descendente y vuelta al
                 orden en que llega. La flecha dice cómo está. -->
            <tr>
              <th
                v-for="c in COLUMNAS"
                :key="c.columna"
                :class="c.clase"
                :aria-sort="ariaSort(c.columna)"
              >
                <button
                  type="button"
                  class="ordenar"
                  :class="{ activo: orden?.columna === c.columna }"
                  :title="`Ordenar por ${c.nombre}`"
                  @click="ordenarPor(c.columna)"
                >
                  <span class="titulo">{{ c.titulo }}</span>
                  <span class="flecha" aria-hidden="true">{{
                    orden?.columna !== c.columna ? '↕' : orden.direccion === 'asc' ? '▲' : '▼'
                  }}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in visibles" :key="e.productoId">
              <td>
                <span class="folio">{{ e.nombre }}</span>
                <span class="sub">{{ e.unidad }} · {{ e.categoria }}</span>
                <span
                  v-if="!e.habilitado"
                  class="deshabilitado"
                  title="Interruptor «Habilitar» apagado en Productos"
                >
                  Deshabilitado: sale agotado
                </span>
              </td>
              <td class="num">{{ e.cantidad }}</td>
              <td class="num" :class="{ apartado: e.comprometido > 0 }">{{ e.comprometido }}</td>
              <td class="num disponible" :class="{ cero: e.disponible === 0 }">
                {{ e.disponible }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty-block">
        {{
          existencias.length === 0
            ? 'La tienda todavía no tiene inventario: se carga al aceptar una transferencia.'
            : 'Ningún producto coincide con la búsqueda.'
        }}
      </p>
    </template>
  </div>
</template>

<style scoped>
h4 {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13px;
  color: var(--ink);
  margin: 18px 0 10px;
}

.transferencia + .transferencia {
  margin-top: 12px;
}

.encabezado {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}

.folio,
.sub {
  display: block;
}

/* Fuera de la tabla no le llega el `.tabla .folio` de base.css. */
.encabezado .folio {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 12px;
  color: var(--ink);
  letter-spacing: 0.03em;
}

.sub {
  font-size: 10.5px;
  color: var(--muted);
  margin-top: 2px;
}

.aceptar {
  width: auto;
  padding: 0 16px;
}

/* El encabezado entero es el botón de ordenar, y se lee igual que un
   encabezado. A diferencia de Facturación sí parte en renglones («Inv.» /
   «físico»): en el teléfono no caben las cuatro columnas de otro modo. */
.ordenar {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 100%;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  text-align: inherit;
  cursor: pointer;
}

.ordenar .titulo {
  white-space: pre-line;
}

.ordenar .flecha {
  font-size: 9px;
  opacity: 0.45;
}

/* La columna por la que se ordena se distingue: flecha y texto en terracota. */
.ordenar.activo,
.ordenar.activo .flecha {
  color: var(--terracotta-dark);
  opacity: 1;
}

td.num.disponible {
  font-weight: 700;
}

td.num.cero {
  color: var(--terracotta);
}

td.num.apartado {
  color: var(--gold);
  font-weight: 700;
}

.deshabilitado {
  display: inline-block;
  margin-top: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--white);
  background: var(--terracotta);
}
</style>
