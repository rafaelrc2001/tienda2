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
 * transferencias y baja con lo que el punto de venta entrega.
 */
import { computed, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { fechaHora } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import type { ExistenciaTienda, Tienda, Transferencia } from '@/api/tipos'

/** La tienda en la que se trabajó la última vez, para no elegirla en cada visita. */
const CLAVE_TIENDA = 'rapidix.pdv.tienda'

const ui = useUiStore()

const tiendas = ref<Tienda[]>([])
const tiendaId = ref('')
const pendientes = ref<Transferencia[]>([])
const existencias = ref<ExistenciaTienda[]>([])
const cargando = ref(true)
const error = ref('')
/** La transferencia que se está aceptando: apaga su botón contra la doble pulsación. */
const aceptando = ref('')
const busqueda = ref('')

const visibles = computed<ExistenciaTienda[]>(() => {
  const termino = busqueda.value.trim().toLowerCase()
  if (!termino) return existencias.value
  return existencias.value.filter((e) =>
    `${e.nombre} ${e.categoria}`.toLowerCase().includes(termino),
  )
})

onMounted(async () => {
  try {
    tiendas.value = await http.get<Tienda[]>('/admin/pdv/tiendas')
    const recordada = localStorage.getItem(CLAVE_TIENDA)
    tiendaId.value = tiendas.value.find((t) => t.id === recordada)?.id ?? tiendas.value[0]?.id ?? ''
  } catch (fallo) {
    error.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos cargar las tiendas.'
  }
  await cargar()
})

async function cargar(): Promise<void> {
  if (!tiendaId.value) {
    cargando.value = false
    return
  }
  cargando.value = true
  error.value = ''
  try {
    const id = tiendaId.value
    const [porAceptar, inventario] = await Promise.all([
      http.get<Transferencia[]>(`/admin/pdv/transferencias?tiendaId=${id}&estado=PENDIENTE`),
      http.get<ExistenciaTienda[]>(`/admin/pdv/tiendas/${id}/inventario`),
    ])
    // Si mientras tanto se cambió de tienda, esta respuesta ya no es la que se ve.
    if (id !== tiendaId.value) return
    pendientes.value = porAceptar
    existencias.value = inventario
  } catch (fallo) {
    error.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos cargar el inventario.'
  } finally {
    cargando.value = false
  }
}

function alCambiarTienda(): void {
  localStorage.setItem(CLAVE_TIENDA, tiendaId.value)
  pendientes.value = []
  existencias.value = []
  void cargar()
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
    <p v-if="!cargando && tiendas.length === 0 && !error" class="empty-block">
      Todavía no hay tiendas. Da de alta una en Configuración → Tiendas.
    </p>

    <template v-else>
      <div v-if="tiendas.length > 1" class="zona-captura">
        <label class="form-label" for="pdv-tienda">Tienda</label>
        <select id="pdv-tienda" v-model="tiendaId" class="select-input" @change="alCambiarTienda">
          <option v-for="t in tiendas" :key="t.id" :value="t.id">{{ t.nombre }}</option>
        </select>
      </div>
      <p v-else-if="tiendas.length === 1" class="tienda-unica">{{ tiendas[0].nombre }}</p>

      <p v-if="error" class="form-error">{{ error }}</p>

      <SkeletonList v-if="cargando" :cantidad="3" />

      <template v-else-if="tiendaId">
        <h4>Transferencias por aceptar</h4>
        <div v-if="pendientes.length > 0" class="tabla-envoltorio">
          <table class="tabla tabla-pendientes">
            <thead>
              <tr>
                <th>Folio</th>
                <th>Productos</th>
                <th class="num">Piezas</th>
                <th>Envía</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in pendientes" :key="t.id">
                <td>
                  <span class="folio">{{ t.folio }}</span>
                  <span class="sub">{{ fechaHora(t.creadoEn) }}</span>
                </td>
                <td>
                  <span v-for="l in t.lineas" :key="l.productoId" class="linea">
                    {{ l.cantidad }} × {{ l.producto }}
                  </span>
                  <span v-if="t.observaciones" class="sub">{{ t.observaciones }}</span>
                </td>
                <td class="num">{{ t.piezas }}</td>
                <td>{{ t.empleado }}</td>
                <td class="num">
                  <button
                    type="button"
                    class="btn-primary aceptar"
                    :disabled="aceptando !== ''"
                    @click="aceptar(t)"
                  >
                    {{ aceptando === t.id ? 'Aceptando…' : 'Aceptar' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="empty-block">No hay transferencias por aceptar.</p>

        <h4>Inventario de la tienda</h4>
        <input
          v-if="existencias.length > 0"
          v-model="busqueda"
          class="form-input"
          type="search"
          placeholder="Buscar en el inventario…"
        />
        <div v-if="visibles.length > 0" class="tabla-envoltorio">
          <table class="tabla">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Grupo</th>
                <th class="num">Existencia</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in visibles" :key="e.productoId">
                <td>
                  <span class="folio">{{ e.nombre }}</span>
                  <span class="sub">{{ e.unidad }}</span>
                </td>
                <td>{{ e.categoria }}</td>
                <td class="num" :class="{ cero: e.cantidad === 0 }">{{ e.cantidad }}</td>
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
    </template>
  </div>
</template>

<style scoped>
.zona-captura {
  background: var(--cream);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 12px 14px 2px;
}

.zona-captura .select-input {
  background: var(--white);
}

.tienda-unica {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 14px;
  color: var(--ink);
  margin: 0;
}

h4 {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13px;
  color: var(--ink);
  margin: 18px 0 10px;
}

.tabla-pendientes {
  min-width: 520px;
}

.sub,
.linea {
  display: block;
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

td.num.cero {
  color: var(--terracotta);
  font-weight: 700;
}
</style>
