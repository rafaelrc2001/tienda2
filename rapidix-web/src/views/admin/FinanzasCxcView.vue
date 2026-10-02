<script setup lang="ts">
/**
 * Administración → Finanzas → CXC: lo que los clientes quedaron a deber y los
 * pagos con que lo van cubriendo.
 *
 * Una cuenta por cobrar es un pedido a crédito que ya se entregó: entra aquí
 * cuando Finanzas acepta su entrega (o al entregarse, si se recogió en tienda)
 * y solo sale pagando. Cada pago puede ser parcial, queda con su fecha y su
 * método, y se anota en Ingresos; el que deja el saldo en cero pasa el pedido
 * a Pagado y la cuenta a «Cobradas». Por eso aquí no hay botón de «marcar
 * pagado»: la cuenta se paga con sus pagos.
 *
 * El saldo, lo pagado y el total por cobrar vienen hechos de la API. La
 * pantalla no suma: solo impide de antemano el pago que pasa del saldo, que la
 * API rechazaría igual (409 `PAGO_EXCEDE_SALDO`).
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fechaDia, fechaHora, nombreMetodoPago } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import { centavos, montoCapturado } from './rutas/liquidacion'
import type { FiltroCxc, ListadoCxc, MetodoPago, PedidoCxc } from '@/api/tipos'

const ui = useUiStore()

const PESTANAS: { filtro: FiltroCxc; titulo: string }[] = [
  { filtro: 'con-saldo', titulo: 'Con saldo' },
  { filtro: 'cobradas', titulo: 'Cobradas' },
]

const METODOS: MetodoPago[] = ['EFECTIVO', 'TRANSFERENCIA']

const filtro = ref<FiltroCxc>('con-saldo')
const pedidos = ref<PedidoCxc[]>([])
const conteos = ref<Record<FiltroCxc, number> | null>(null)
const porCobrar = ref(0)
const cargando = ref(true)
const abierto = ref<string | null>(null)

/** Cambiar de pestaña rápido deja respuestas viejas en el aire: gana la última. */
let peticion = 0

async function cargar(conEsqueleto = true): Promise<void> {
  const numero = ++peticion
  if (conEsqueleto) cargando.value = true
  try {
    const respuesta = await http.get<ListadoCxc>('/admin/finanzas/cxc', {
      query: { filtro: filtro.value },
    })
    if (numero !== peticion) return
    pedidos.value = respuesta.pedidos
    conteos.value = respuesta.conteos
    porCobrar.value = respuesta.porCobrar
  } catch (fallo) {
    if (numero === peticion) ui.errorDeApi(fallo)
  } finally {
    if (numero === peticion) cargando.value = false
  }
}

onMounted(() => cargar())

function elegir(nuevo: FiltroCxc): void {
  if (nuevo === filtro.value) return
  filtro.value = nuevo
  abierto.value = null
  void cargar()
}

function alternar(id: string): void {
  abierto.value = abierto.value === id ? null : id
}

// ------------------------------------------------------------------
// Registrar pago
// ------------------------------------------------------------------

const pagando = ref<PedidoCxc | null>(null)
/** Texto y no número: el campo vacío no es cero. */
const monto = ref('')
const metodo = ref<MetodoPago>('EFECTIVO')
const nota = ref('')
const errorMonto = ref('')
const guardando = ref(false)

function abrirPago(pedido: PedidoCxc): void {
  // Se propone el saldo entero: liquidar la cuenta es lo normal, y abonar es borrar y escribir.
  monto.value = String(pedido.saldo)
  metodo.value = 'EFECTIVO'
  nota.value = ''
  errorMonto.value = ''
  pagando.value = pedido
}

/** Más de cero y no más de lo que se debe. La API lo vuelve a comprobar. */
function errorDelPago(saldo: number): string {
  const capturado = montoCapturado(monto.value)
  if (capturado === null) return 'Escribe cuánto pagó.'
  if (capturado <= 0) return 'El pago tiene que ser mayor que cero.'
  if (centavos(capturado - saldo) > 0) return `No puede pasar de lo que debe: ${dinero(saldo)}.`
  return ''
}

async function registrarPago(): Promise<void> {
  const pedido = pagando.value
  if (!pedido) return
  errorMonto.value = errorDelPago(pedido.saldo)
  if (errorMonto.value) return

  guardando.value = true
  try {
    const actualizado = await http.post<PedidoCxc>(`/admin/finanzas/cxc/${pedido.id}/pagos`, {
      monto: montoCapturado(monto.value),
      metodo: metodo.value,
      ...(nota.value.trim() ? { nota: nota.value.trim() } : {}),
    })
    pedidos.value = pedidos.value.map((p) => (p.id === actualizado.id ? actualizado : p))
    ui.exito(
      actualizado.saldo > 0
        ? `Pago registrado. ${actualizado.clienteNombre} debe ${dinero(actualizado.saldo)}.`
        : `Cuenta de ${actualizado.clienteNombre} cobrada: el pedido queda pagado.`,
    )
    pagando.value = null
  } catch (fallo) {
    // Un 409 aquí es que el saldo cambió entre medias: otro pago, o ya está cobrada.
    errorMonto.value = fallo instanceof ErrorApi ? fallo.message : 'No se pudo registrar el pago.'
    return
  } finally {
    guardando.value = false
  }
  // El total por cobrar y los contadores cambian; la cuenta saldada cambia de pestaña.
  await cargar(false)
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin/finanzas" class="admin-back-inline">← Finanzas · Pedidos</RouterLink>

    <div class="subtab-row" role="tablist">
      <button
        v-for="p in PESTANAS"
        :key="p.filtro"
        type="button"
        role="tab"
        class="subtab"
        :class="{ active: filtro === p.filtro }"
        :aria-selected="filtro === p.filtro"
        @click="elegir(p.filtro)"
      >
        {{ p.titulo }}<template v-if="conteos"> · {{ conteos[p.filtro] }}</template>
      </button>
    </div>

    <SkeletonList v-if="cargando" :cantidad="3" />

    <template v-else>
      <!-- Lo que se debe entre todas las cuentas con saldo, sumado por la API. -->
      <div class="total">
        <span class="total-titulo">Por cobrar</span>
        <strong class="total-monto">{{ dinero(porCobrar) }}</strong>
      </div>

      <div v-if="pedidos.length > 0" class="tabla-envoltorio">
        <table class="tabla lineal">
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>En CXC desde</th>
              <th class="num">Total</th>
              <th class="num">Pagos</th>
              <th class="num">Saldo</th>
              <th v-if="filtro === 'con-saldo'">Acción</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="pedido in pedidos" :key="pedido.id">
              <tr :class="{ 'con-detalle': abierto === pedido.id }">
                <td>
                  <span class="folio">{{ pedido.folio }}</span>
                  <span class="sub">{{ pedido.repartoFolio ?? 'Recogido en tienda' }}</span>
                  <div class="enlaces">
                    <button type="button" class="enlace" @click="alternar(pedido.id)">
                      {{ abierto === pedido.id ? 'Ocultar detalle' : 'Ver detalle' }}
                    </button>
                  </div>
                </td>
                <td>
                  {{ pedido.clienteNombre }}
                  <span class="sub">{{ pedido.clienteTelefono }}</span>
                </td>
                <td class="fecha">{{ fechaDia(pedido.cxcDesde) }}</td>
                <td class="num">{{ dinero(pedido.total) }}</td>
                <td class="num">{{ dinero(pedido.pagado) }}</td>
                <td class="num importe" :class="{ debe: pedido.saldo > 0 }">
                  {{ pedido.saldo > 0 ? dinero(pedido.saldo) : 'Cobrada' }}
                </td>
                <td v-if="filtro === 'con-saldo'" class="accion">
                  <button
                    v-if="pedido.saldo > 0"
                    type="button"
                    class="btn-primary"
                    @click="abrirPago(pedido)"
                  >
                    Registrar pago
                  </button>
                </td>
              </tr>

              <!-- Qué se llevó, cómo se ha cubierto y cuándo pagó cada vez. -->
              <tr v-if="abierto === pedido.id" class="fila-detalle">
                <td :colspan="filtro === 'con-saldo' ? 7 : 6">
                  <p class="detalle-titulo">Productos</p>
                  <table class="tabla-lineas angosta">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th class="num">Cantidad</th>
                        <th class="num">Precio</th>
                        <th class="num">Importe</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(producto, i) in pedido.productos" :key="i">
                        <td>{{ producto.nombre }}</td>
                        <td class="num">
                          {{ producto.cantidad }} <span class="unidad">{{ producto.unidad }}</span>
                        </td>
                        <td class="num">{{ dinero(producto.precioUnitario) }}</td>
                        <td class="num">{{ dinero(producto.importe) }}</td>
                      </tr>
                    </tbody>
                  </table>

                  <p class="detalle-titulo">Cómo se cubrió</p>
                  <table class="tabla-lineas angosta">
                    <tbody>
                      <tr>
                        <td>Total del pedido</td>
                        <td class="num">{{ dinero(pedido.total) }}</td>
                      </tr>
                      <tr v-if="pedido.pagadoConBilletera > 0">
                        <td>Pagado con billetera</td>
                        <td class="num abono">{{ dinero(pedido.pagadoConBilletera) }}</td>
                      </tr>
                      <tr>
                        <td>Pagos recibidos</td>
                        <td class="num abono">{{ dinero(pedido.pagado) }}</td>
                      </tr>
                      <tr class="fuerte">
                        <td>Saldo</td>
                        <td class="num" :class="{ debe: pedido.saldo > 0 }">
                          {{ dinero(pedido.saldo) }}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <p class="detalle-titulo">Pagos</p>
                  <table v-if="pedido.pagos.length > 0" class="tabla-lineas angosta">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Método</th>
                        <th>Recibió</th>
                        <th>Nota</th>
                        <th class="num">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="pago in pedido.pagos" :key="pago.id">
                        <td class="fecha">{{ fechaHora(pago.creadoEn) }}</td>
                        <td>{{ nombreMetodoPago(pago.metodo) }}</td>
                        <td>{{ pago.registradoPorNombre }}</td>
                        <td>{{ pago.nota ?? '—' }}</td>
                        <td class="num abono">{{ dinero(pago.monto) }}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p v-else class="sin-pagos">Todavía no ha pagado nada.</p>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <p v-else class="empty-block">
        {{
          filtro === 'con-saldo'
            ? 'Ningún cliente debe: no hay cuentas por cobrar con saldo. 🎉'
            : 'Todavía no se ha cobrado ninguna cuenta.'
        }}
      </p>
    </template>

    <!-- Un pago, que puede ser parcial. Queda con su fecha, su método y su ingreso. -->
    <div v-if="pagando" class="modal-overlay" @click.self="pagando = null">
      <div class="modal-sheet" role="dialog" aria-label="Registrar pago">
        <div class="modal-handle" />
        <p class="modal-title">Registrar pago · {{ pagando.folio }}</p>
        <p class="modal-texto">
          {{ pagando.clienteNombre }} debe {{ dinero(pagando.saldo) }}. Puede pagar una parte: el
          pago queda anotado en Ingresos y, cuando el saldo llegue a cero, el pedido pasa a Pagado.
        </p>

        <div class="zona-captura">
          <label class="form-label" for="pago-monto">Cuánto paga</label>
          <input
            id="pago-monto"
            v-model="monto"
            class="form-input monto"
            :class="{ 'is-invalid': errorMonto }"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0.00"
            @keyup.enter="registrarPago"
          />
          <p v-if="errorMonto" class="form-error">{{ errorMonto }}</p>

          <label class="form-label" for="pago-metodo">Cómo paga</label>
          <select id="pago-metodo" v-model="metodo" class="form-input">
            <option v-for="m in METODOS" :key="m" :value="m">{{ nombreMetodoPago(m) }}</option>
          </select>

          <label class="form-label" for="pago-nota">Nota (opcional)</label>
          <textarea
            id="pago-nota"
            v-model="nota"
            class="form-textarea"
            rows="2"
            maxlength="500"
            placeholder="Ej.: referencia de la transferencia"
          />
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" :disabled="guardando" @click="pagando = null">
            Volver
          </button>
          <button type="button" class="btn-primary" :disabled="guardando" @click="registrarPago">
            {{ guardando ? 'Guardando…' : 'Registrar pago' }}
          </button>
        </div>
      </div>
    </div>
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
  padding: 0 0 8px;
  text-decoration: none;
}

.subtab-row {
  margin: 0 0 12px;
}

.total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  background: var(--white);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
  border-left: 4px solid var(--terracotta);
  padding: 12px 14px;
  margin-bottom: 12px;
}

.total-titulo {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  color: var(--muted);
}

.total-monto {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 20px;
  color: var(--ink);
  white-space: nowrap;
}

.tabla {
  min-width: 760px;
}

.tabla .fecha {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.tabla > tbody > tr > td.debe,
.tabla-lineas td.debe {
  color: var(--rojo);
}

.detalle-titulo {
  margin: 12px 0 4px;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 12px;
  color: var(--ink);
}

.detalle-titulo:first-child {
  margin-top: 0;
}

.tabla-lineas.angosta {
  max-width: 620px;
}

.tabla-lineas .fecha {
  color: var(--muted);
}

.tabla-lineas .unidad {
  color: var(--muted);
  font-size: 10.5px;
}

.tabla-lineas .abono {
  font-family: var(--font-heading);
  font-weight: 700;
  color: var(--verde-dark);
}

.sin-pagos {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

.modal-texto {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.45;
}

/* Donde se escribe: bloque crema y campos blancos, para que se vea dónde capturar. */
.zona-captura {
  background: var(--cream-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  margin-bottom: 12px;
}

.zona-captura .form-input,
.zona-captura .form-textarea {
  background: var(--white);
}

.zona-captura .form-textarea {
  margin-bottom: 0;
}

/* 16px reales: con menos, Safari en iPhone amplía la página al enfocar el campo. */
.monto {
  font-size: 16px;
  font-weight: 700;
  text-align: right;
}

.form-error {
  margin: -4px 0 10px;
}
</style>
