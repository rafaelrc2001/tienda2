<script setup lang="ts">
/**
 * Productos → ventana «Movimientos»: entradas y salidas de bodega.
 *
 * Un encabezado —empleado, tipo, a qué saldo afecta, motivo, observaciones—
 * para todos los renglones del lote, y una cantidad por producto. Se registra
 * en una sola transacción: si a un renglón no le alcanza el saldo, no se
 * guarda ninguno.
 *
 * Las cantidades capturadas viven en un objeto aparte, **no en el DOM**. Es lo
 * que permite buscar un producto sin perder lo ya capturado: filtrar redibuja
 * la tabla y lo escrito sobrevive.
 */
import { computed, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { fechaHora } from '@/utils/formato'
import type {
  AfectaInventario,
  MotivoMovimiento,
  MovimientoInventario,
  ResumenLote,
  SaldoProducto,
  TipoMovimiento,
} from '@/api/tipos'
import { AFECTA, MOTIVOS_CAPTURA, TIPOS, nombreAfecta, nombreMotivo, soloNumeros } from './etiquetas'

const props = defineProps<{ saldos: SaldoProducto[] }>()
const emit = defineEmits<{ registrado: [] }>()

const ui = useUiStore()

// ---- Encabezado del lote ----
const empleado = ref('')
const tipo = ref<TipoMovimiento>('ENTRADA')
const afecta = ref<AfectaInventario>('AMBOS')
const motivo = ref<MotivoMovimiento>('COMPRA')
const observaciones = ref('')
const errorEncabezado = ref('')

// ---- Captura ----
/** `productoId` → piezas. Sobrevive a que se redibuje la tabla. */
const cantidades = ref<Record<string, number>>({})
const busqueda = ref('')
const registrando = ref(false)

// ---- Historial ----
const historial = ref<MovimientoInventario[]>([])
const cargandoHistorial = ref(true)
const filtroProducto = ref('')
const filtroMotivo = ref('')

const ayudaAfecta = computed(() => AFECTA.find((a) => a.valor === afecta.value)?.ayuda ?? '')

const visibles = computed<SaldoProducto[]>(() => {
  const termino = busqueda.value.trim().toLowerCase()
  if (!termino) return props.saldos
  return props.saldos.filter((s) =>
    `${s.nombre} ${s.categoria}`.toLowerCase().includes(termino),
  )
})

/** Lo que se va a registrar. Es también el resumen que se enseña (M-8). */
const lineas = computed(() =>
  Object.entries(cantidades.value)
    .filter(([, cantidad]) => cantidad > 0)
    .map(([productoId, cantidad]) => ({ productoId, cantidad })),
)

const piezas = computed(() => lineas.value.reduce((suma, l) => suma + l.cantidad, 0))

onMounted(() => void cargarHistorial())

async function cargarHistorial(): Promise<void> {
  cargandoHistorial.value = true
  try {
    const parametros = new URLSearchParams()
    if (filtroProducto.value) parametros.set('productoId', filtroProducto.value)
    if (filtroMotivo.value) parametros.set('motivo', filtroMotivo.value)
    const cadena = parametros.toString()
    historial.value = await http.get<MovimientoInventario[]>(
      `/admin/inventario/movimientos${cadena ? `?${cadena}` : ''}`,
    )
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargandoHistorial.value = false
  }
}

function limpiarCantidades(): void {
  cantidades.value = {}
}

/** El `v-model.number` deja `NaN` y cadena vacía; aquí solo entran enteros. */
function anotar(productoId: string, valor: string): void {
  const cantidad = Number.parseInt(valor, 10)
  if (Number.isFinite(cantidad) && cantidad > 0) {
    cantidades.value = { ...cantidades.value, [productoId]: cantidad }
    return
  }
  const { [productoId]: _fuera, ...resto } = cantidades.value
  cantidades.value = resto
}

async function registrar(): Promise<void> {
  errorEncabezado.value = ''
  if (empleado.value.trim().length < 2) {
    errorEncabezado.value = 'Escribe quién movió la mercancía.'
    return
  }
  if (lineas.value.length === 0) {
    errorEncabezado.value = 'Captura la cantidad de al menos un producto.'
    return
  }

  registrando.value = true
  try {
    const resumen = await http.post<ResumenLote>('/admin/inventario/movimientos', {
      empleado: empleado.value.trim(),
      tipo: tipo.value,
      afecta: afecta.value,
      motivo: motivo.value,
      ...(observaciones.value.trim() && { observaciones: observaciones.value.trim() }),
      lineas: lineas.value,
    })
    ui.exito(`${resumen.productos} producto(s) · ${resumen.piezas} pieza(s)`)
    // Se limpian las cantidades pero no el encabezado: lo normal es seguir
    // capturando la misma factura con el mismo empleado y el mismo motivo.
    limpiarCantidades()
    await cargarHistorial()
    emit('registrado')
  } catch (fallo) {
    // El 409 de saldo insuficiente dice cuánto hay: se enseña tal cual, que es
    // justo el dato que el encargado necesita para corregir la captura.
    errorEncabezado.value = fallo instanceof ErrorApi ? fallo.message : 'No se pudo registrar.'
    if (!(fallo instanceof ErrorApi)) ui.errorDeApi(fallo)
  } finally {
    registrando.value = false
  }
}
</script>

<template>
  <div class="ventana-movimientos">
    <!-- Encabezado del lote: aplica a todos los renglones -->
    <section class="encabezado">
      <div class="campos">
        <div>
          <label class="form-label" for="mv-empleado">Empleado</label>
          <input
            id="mv-empleado"
            v-model="empleado"
            class="form-input"
            placeholder="Quién mueve la mercancía"
          />
        </div>
        <div>
          <label class="form-label" for="mv-tipo">Tipo de movimiento</label>
          <select id="mv-tipo" v-model="tipo" class="select-input">
            <option v-for="t in TIPOS" :key="t.valor" :value="t.valor">{{ t.etiqueta }}</option>
          </select>
        </div>
        <div>
          <label class="form-label" for="mv-afecta">Afecta</label>
          <select id="mv-afecta" v-model="afecta" class="select-input">
            <option v-for="a in AFECTA" :key="a.valor" :value="a.valor">{{ a.etiqueta }}</option>
          </select>
        </div>
        <div>
          <label class="form-label" for="mv-motivo">Motivo</label>
          <select id="mv-motivo" v-model="motivo" class="select-input">
            <option v-for="m in MOTIVOS_CAPTURA" :key="m.valor" :value="m.valor">
              {{ m.etiqueta }}
            </option>
          </select>
        </div>
      </div>

      <p class="form-hint">{{ ayudaAfecta }}</p>

      <label class="form-label" for="mv-obs">Observaciones</label>
      <input
        id="mv-obs"
        v-model="observaciones"
        class="form-input"
        placeholder="Notas adicionales"
      />

      <p v-if="errorEncabezado" class="form-error">{{ errorEncabezado }}</p>

      <div class="acciones">
        <button
          type="button"
          class="btn-primary"
          :disabled="registrando || lineas.length === 0"
          @click="registrar"
        >
          {{ registrando ? 'Registrando…' : 'Registrar' }}
        </button>
        <button
          type="button"
          class="btn-secondary"
          :disabled="lineas.length === 0"
          @click="limpiarCantidades"
        >
          Limpiar cantidades
        </button>
      </div>

      <p class="resumen" :class="{ vacio: lineas.length === 0 }">
        {{ lineas.length }} producto{{ lineas.length === 1 ? '' : 's' }} · {{ piezas }} pieza{{
          piezas === 1 ? '' : 's'
        }}
      </p>
    </section>

    <!-- Captura -->
    <input v-model="busqueda" class="form-input" type="search" placeholder="Buscar producto…" />

    <div v-if="visibles.length > 0" class="tabla-scroll">
      <table class="tabla-captura">
        <thead>
          <tr>
            <th class="col-producto">Producto</th>
            <th>Grupo</th>
            <th class="num">Físico actual</th>
            <th class="num">Apt. venta actual</th>
            <th class="num">Cantidad</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="saldo in visibles" :key="saldo.id">
            <th class="col-producto" scope="row">{{ saldo.nombre }}</th>
            <td>{{ saldo.categoria }}</td>
            <td class="num">{{ saldo.inventario }}</td>
            <td class="num">{{ saldo.aptInventario }}</td>
            <td class="num">
              <input
                class="cantidad"
                :class="{ capturada: (cantidades[saldo.id] ?? 0) > 0 }"
                type="number"
                min="1"
                step="1"
                inputmode="numeric"
                :value="cantidades[saldo.id] ?? ''"
                :aria-label="`Cantidad de ${saldo.nombre}`"
                @keydown="soloNumeros"
                @input="anotar(saldo.id, ($event.target as HTMLInputElement).value)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else class="empty-block">
      {{
        saldos.length === 0
          ? 'Todavía no hay productos en el catálogo.'
          : 'Ningún producto coincide con la búsqueda.'
      }}
    </p>

    <!-- Bitácora -->
    <section class="historial">
      <h4>Historial de movimientos</h4>
      <div class="filtros">
        <select v-model="filtroProducto" class="select-input" @change="cargarHistorial">
          <option value="">Todos los productos</option>
          <option v-for="s in saldos" :key="s.id" :value="s.id">{{ s.nombre }}</option>
        </select>
        <select v-model="filtroMotivo" class="select-input" @change="cargarHistorial">
          <option value="">Todos los motivos</option>
          <option v-for="m in MOTIVOS_CAPTURA" :key="m.valor" :value="m.valor">
            {{ m.etiqueta }}
          </option>
          <option value="VENTA">Venta</option>
        </select>
      </div>

      <p v-if="cargandoHistorial" class="empty-block">Cargando…</p>

      <div v-else-if="historial.length > 0" class="tabla-scroll">
        <table class="tabla-historial">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Producto</th>
              <th>Tipo</th>
              <th class="num">Cantidad</th>
              <th>Empleado</th>
              <th>Motivo</th>
              <th class="num">Saldo tras el movimiento</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in historial" :key="m.id">
              <td class="fecha">{{ fechaHora(m.creadoEn) }}</td>
              <td>{{ m.producto }}</td>
              <td>
                <span class="mini-tag" :class="m.tipo === 'ENTRADA' ? 'entrada' : 'salida'">
                  {{ m.tipo === 'ENTRADA' ? 'Entrada' : 'Salida' }}
                </span>
                <span class="afecta">{{ nombreAfecta(m.afecta) }}</span>
              </td>
              <td class="num">{{ m.tipo === 'ENTRADA' ? '+' : '−' }}{{ m.cantidad }}</td>
              <td>
                {{ m.empleado }}
                <span v-if="m.usuarioNombre" class="capturo">capturó {{ m.usuarioNombre }}</span>
              </td>
              <td>
                {{ nombreMotivo(m.motivo) }}
                <span v-if="m.observaciones" class="obs">{{ m.observaciones }}</span>
              </td>
              <td class="num saldos">
                {{ m.fisicoDespues }} físico
                <span>{{ m.aptDespues }} apt. venta</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-else class="empty-block">Todavía no se ha movido nada en bodega.</p>
    </section>
  </div>
</template>

<style scoped>
.encabezado {
  background: var(--white);
  border-radius: 14px;
  padding: 14px;
  box-shadow: var(--shadow);
  margin-bottom: 14px;
}

.campos {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 0 10px;
}

.form-hint {
  font-size: 11.5px;
  color: var(--muted);
  margin: 0 0 10px;
}

.acciones {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.acciones .btn-primary,
.acciones .btn-secondary {
  width: auto;
  padding: 0 20px;
}

.resumen {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11.5px;
  color: var(--sage);
  margin: 10px 0 0;
}

.resumen.vacio {
  color: var(--muted);
}

.tabla-scroll {
  overflow: auto;
  max-height: 55vh;
  background: var(--white);
  border-radius: 14px;
  box-shadow: var(--shadow);
  margin-top: 10px;
}

table {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  font-size: 12px;
}

th,
td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
  background: var(--white);
  vertical-align: top;
}

thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--cream);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

.col-producto {
  position: sticky;
  left: 0;
  z-index: 1;
  font-family: var(--font-heading);
  font-weight: 700;
  color: var(--ink);
  box-shadow: 1px 0 0 var(--line);
}

thead .col-producto {
  z-index: 3;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/*
 * 16px es obligatorio: por debajo de eso Safari en iOS hace zoom al enfocar el
 * campo y deja la tabla descuadrada. Se compensa encogiendo la caja, que no
 * dispara el zoom.
 */
.cantidad {
  width: 78px;
  font-size: 16px;
  transform: scale(0.9);
  text-align: right;
  padding: 5px 7px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--cream);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.cantidad:focus {
  outline: none;
  border-color: var(--terracotta);
}

.cantidad.capturada {
  border-color: var(--sage);
  background: rgba(76, 175, 80, 0.12);
  font-weight: 700;
}

.historial {
  margin-top: 22px;
}

.historial h4 {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13px;
  color: var(--ink);
  margin: 0 0 10px;
}

.filtros {
  display: flex;
  gap: 8px;
}

.filtros .select-input {
  flex: 1;
  min-width: 0;
  margin-bottom: 0;
}

.mini-tag.entrada {
  background: rgba(76, 175, 80, 0.15);
  color: var(--sage);
}

.mini-tag.salida {
  background: rgba(245, 124, 0, 0.12);
  color: var(--terracotta-dark);
}

.fecha,
.afecta,
.obs,
.capturo {
  color: var(--muted);
}

.afecta,
.obs,
.capturo {
  display: block;
  font-size: 10px;
  margin-top: 2px;
  white-space: normal;
  max-width: 220px;
}

.saldos {
  font-weight: 700;
  color: var(--ink);
}

.saldos span {
  display: block;
  font-weight: 400;
  font-size: 10.5px;
  color: var(--muted);
}
</style>
