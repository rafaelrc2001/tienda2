<script setup lang="ts">
/**
 * Finanzas → Bancos → 🌐 Factura global: los depósitos palomeados, facturados
 * juntos a PÚBLICO EN GENERAL.
 *
 * El receptor (RFC genérico, régimen 616, uso S01, método PUE) lo fija el SAT:
 * se enseña y no se edita. Lo que sí se elige es la forma de pago (llega con
 * la del depósito de mayor monto), la periodicidad, el mes, el año y los
 * productos con su cantidad.
 *
 * Los precios no se escriben: la API reparte el total entre los productos para
 * que, con el IVA redondeado, la factura dé exactamente lo depositado. Cada
 * cambio en la tabla pide otra vista previa; aquí no se suma nada.
 *
 * Tocar fuera de la hoja no la cierra: con la tabla a medias se perdería lo
 * capturado.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero } from '@/utils/formato'
import { cantidadDeProducto } from './bancos'
import type { DatosFacturaGlobal, FacturaGlobal, VistaFacturaGlobal } from '@/api/tipos'

const props = defineProps<{
  movimientoIds: string[]
  /** El mes del periodo: con él se proponen el mes y el año del CFDI. */
  periodo: { anio: number; mes: number }
}>()

const emit = defineEmits<{
  (e: 'cerrar'): void
  /** Ya timbrada, o alguien se llevó los movimientos: quien abrió relee el periodo. */
  (e: 'facturado', factura: FacturaGlobal | null): void
}>()

const RUTA = '/admin/finanzas/bancos/factura-global'
const BIMESTRAL = '05'

const ui = useUiStore()
const datos = ref<DatosFacturaGlobal | null>(null)
const cargando = ref(true)

interface Renglon {
  /** Solo para el `key` del v-for: dos renglones vacíos no tienen otra cosa que los distinga. */
  clave: number
  productoId: string
  cantidad: string
}
let siguienteClave = 0
const nuevoRenglon = (): Renglon => ({ clave: ++siguienteClave, productoId: '', cantidad: '' })
const renglones = ref<Renglon[]>([nuevoRenglon()])

const formaPago = ref('')
const periodicidad = ref('04')
const meses = ref(String(props.periodo.mes).padStart(2, '0'))
const anio = ref(String(props.periodo.anio))
const email = ref('')

const vista = ref<VistaFacturaGlobal | null>(null)
/** La suma de los depósitos, de la primera respuesta: se ve aunque la tabla esté a medias. */
const total = ref<number | null>(null)
const errorVista = ref('')
const calculando = ref(false)
const enviando = ref(false)
const errorEnvio = ref('')

onMounted(async () => {
  try {
    const [respuesta, suma] = await Promise.all([
      http.get<DatosFacturaGlobal>(`${RUTA}/datos`),
      http.post<VistaFacturaGlobal>(`${RUTA}/previsualizar`, {
        movimientoIds: props.movimientoIds,
        renglones: [],
      }),
    ])
    datos.value = respuesta
    total.value = suma.total
    formaPago.value = suma.formaPagoSugerida
  } catch (fallo) {
    ui.errorDeApi(fallo)
    emit('cerrar')
  } finally {
    cargando.value = false
  }
})

const simulado = computed(() => datos.value?.modo === 'SIMULADO')
const porId = computed(() => new Map((datos.value?.productos ?? []).map((p) => [p.id, p])))

/** Un producto ya elegido en otro renglón no se ofrece otra vez. */
function disponibles(renglon: Renglon) {
  const ocupados = new Set(
    renglones.value.filter((r) => r !== renglon && r.productoId).map((r) => r.productoId),
  )
  return (datos.value?.productos ?? []).filter((p) => !ocupados.has(p.id))
}

/** El error de la cantidad de un renglón, solo cuando ya se escribió algo. */
function errorCantidad(renglon: Renglon): string {
  if (renglon.cantidad.trim() === '') return ''
  return cantidadDeProducto(renglon.cantidad) === null
    ? 'Mayor que cero, hasta tres decimales.'
    : ''
}

/** El concepto que repartió la API para el producto del renglón. */
function concepto(renglon: Renglon) {
  return vista.value?.conceptos.find((c) => c.productoId === renglon.productoId) ?? null
}

const completos = computed(
  () =>
    renglones.value.length > 0 &&
    renglones.value.every((r) => r.productoId && cantidadDeProducto(r.cantidad) !== null),
)

const todosElegidos = computed(() => renglones.value.length >= (datos.value?.productos.length ?? 0))

function agregarRenglon(): void {
  renglones.value.push(nuevoRenglon())
}

function quitarRenglon(renglon: Renglon): void {
  renglones.value = renglones.value.filter((r) => r !== renglon)
  if (renglones.value.length === 0) renglones.value.push(nuevoRenglon())
}

// ------------------------------------------------------------------
// Vista previa: la API pone los precios
// ------------------------------------------------------------------

/** Escribir la cantidad dispara una petición por tecla: gana la última. */
let peticion = 0
let espera: ReturnType<typeof setTimeout> | undefined

watch(
  renglones,
  () => {
    clearTimeout(espera)
    errorVista.value = ''
    if (!completos.value) {
      vista.value = null
      peticion++
      return
    }
    espera = setTimeout(previsualizar, 300)
  },
  { deep: true },
)

onBeforeUnmount(() => clearTimeout(espera))

async function previsualizar(): Promise<void> {
  const numero = ++peticion
  calculando.value = true
  try {
    const respuesta = await http.post<VistaFacturaGlobal>(`${RUTA}/previsualizar`, cuerpoBase())
    if (numero !== peticion) return
    vista.value = respuesta
    total.value = respuesta.total
  } catch (fallo) {
    if (numero !== peticion) return
    vista.value = null
    if (!(fallo instanceof ErrorApi)) ui.errorDeApi(fallo)
    else if (esDeMovimientos(fallo)) avisarYCerrar(fallo)
    else errorVista.value = fallo.message
  } finally {
    if (numero === peticion) calculando.value = false
  }
}

function cuerpoBase() {
  return {
    movimientoIds: props.movimientoIds,
    renglones: renglones.value.map((r) => ({
      productoId: r.productoId,
      cantidad: cantidadDeProducto(r.cantidad)!,
    })),
  }
}

/** Otra pestaña facturó o borró un movimiento mientras tanto: lo que sirve es el periodo al día. */
function esDeMovimientos(fallo: ErrorApi): boolean {
  return fallo.codigo === 'MOVIMIENTO_YA_FACTURADO' || fallo.codigo === 'MOVIMIENTO_NO_ENCONTRADO'
}

function avisarYCerrar(fallo: ErrorApi): void {
  ui.info(fallo.message)
  emit('facturado', null)
}

// ------------------------------------------------------------------
// Periodicidad y mes
// ------------------------------------------------------------------

/** Los meses que caben con la periodicidad: los bimestres solo con la bimestral. */
const mesesDisponibles = computed(() =>
  (datos.value?.meses ?? []).filter((m) =>
    periodicidad.value === BIMESTRAL ? Number(m.clave) >= 13 : Number(m.clave) <= 12,
  ),
)

/** Al cambiar de mensual a bimestral (y al revés) se pasa al bimestre del mes, no a enero. */
watch(periodicidad, (nueva) => {
  const n = Number(meses.value)
  if (nueva === BIMESTRAL && n <= 12) meses.value = String(13 + Math.floor((n - 1) / 2))
  else if (nueva !== BIMESTRAL && n >= 13) meses.value = String((n - 13) * 2 + 1).padStart(2, '0')
})

// ------------------------------------------------------------------
// Timbrar
// ------------------------------------------------------------------

const puedeTimbrar = computed(
  () => completos.value && vista.value !== null && !calculando.value && !enviando.value,
)

async function timbrar(): Promise<void> {
  if (!puedeTimbrar.value) return
  errorEnvio.value = ''
  const anioNumero = Number(anio.value)
  if (!Number.isInteger(anioNumero) || anioNumero < 2000 || anioNumero > 2100) {
    errorEnvio.value = 'Escribe un año válido.'
    return
  }
  enviando.value = true
  try {
    const factura = await http.post<FacturaGlobal>(RUTA, {
      ...cuerpoBase(),
      formaPago: formaPago.value,
      periodicidad: periodicidad.value,
      meses: meses.value,
      anio: anioNumero,
      ...(email.value.trim() && { email: email.value.trim() }),
    })
    emit('facturado', factura)
  } catch (fallo) {
    if (!(fallo instanceof ErrorApi)) ui.errorDeApi(fallo)
    else if (esDeMovimientos(fallo)) avisarYCerrar(fallo)
    // El rechazo del SAT (422) y los candados (409/400) se quedan en la hoja.
    else errorEnvio.value = fallo.mensajes.length > 1 ? fallo.mensajes.join(' ') : fallo.message
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <div class="modal-overlay">
    <div class="modal-sheet ancha" role="dialog" aria-modal="true" aria-label="Factura global">
      <div class="modal-handle" />
      <p class="modal-title">
        🌐 Factura global<template v-if="total !== null"> · {{ dinero(total) }}</template>
      </p>

      <p v-if="cargando" class="modal-texto">Cargando…</p>

      <form v-else-if="datos" novalidate @submit.prevent="timbrar">
        <p v-if="simulado" class="aviso-demo">
          Modo demostración: la factura se genera con un folio de prueba y no tiene validez fiscal.
        </p>

        <!-- Lo que fija el SAT: se ve, no se toca. -->
        <section class="fijos" aria-label="Datos fijos del SAT">
          <p class="seccion">🔒 Receptor · fijo por el SAT</p>
          <dl>
            <div>
              <dt>RFC</dt>
              <dd>{{ datos.receptor.rfc }}</dd>
            </div>
            <div>
              <dt>Razón social</dt>
              <dd>{{ datos.receptor.razonSocial }}</dd>
            </div>
            <div>
              <dt>Régimen fiscal</dt>
              <dd>
                {{ datos.receptor.regimenFiscal.clave }} · {{ datos.receptor.regimenFiscal.nombre }}
              </dd>
            </div>
            <div>
              <dt>Uso del CFDI</dt>
              <dd>{{ datos.receptor.usoCfdi.clave }} · {{ datos.receptor.usoCfdi.nombre }}</dd>
            </div>
            <div>
              <dt>Código postal</dt>
              <dd>{{ datos.receptor.cpFiscal }} (lugar de expedición)</dd>
            </div>
            <div>
              <dt>Método de pago</dt>
              <dd>
                {{ datos.receptor.metodoPago.clave }} · {{ datos.receptor.metodoPago.nombre }}
              </dd>
            </div>
          </dl>
        </section>

        <!-- Lo que se elige: bloque crema, campos blancos. -->
        <section class="zona-captura" aria-label="Datos de la factura">
          <div class="rejilla">
            <div class="campo ancho">
              <label class="form-label" for="fg-forma-pago">Forma de pago</label>
              <select id="fg-forma-pago" v-model="formaPago" class="form-input">
                <option v-for="f in datos.formasPago" :key="f.clave" :value="f.clave">
                  {{ f.clave }} · {{ f.descripcion }}
                </option>
              </select>
            </div>
            <div class="campo">
              <label class="form-label" for="fg-periodicidad">Periodicidad</label>
              <select id="fg-periodicidad" v-model="periodicidad" class="form-input">
                <option v-for="p in datos.periodicidades" :key="p.clave" :value="p.clave">
                  {{ p.clave }} · {{ p.nombre }}
                </option>
              </select>
            </div>
            <div class="campo">
              <label class="form-label" for="fg-meses">Mes</label>
              <select id="fg-meses" v-model="meses" class="form-input">
                <option v-for="m in mesesDisponibles" :key="m.clave" :value="m.clave">
                  {{ m.clave }} · {{ m.nombre }}
                </option>
              </select>
            </div>
            <div class="campo">
              <label class="form-label" for="fg-anio">Año</label>
              <input
                id="fg-anio"
                v-model="anio"
                class="form-input"
                type="text"
                inputmode="numeric"
                maxlength="4"
              />
            </div>
            <div class="campo ancho">
              <label class="form-label" for="fg-email">Correo (opcional)</label>
              <input
                id="fg-email"
                v-model="email"
                class="form-input"
                type="email"
                autocomplete="off"
                placeholder="A dónde mandar el PDF y el XML"
              />
            </div>
          </div>
          <p class="form-hint">
            La forma de pago viene con la del depósito de mayor monto, como lo pide el SAT.
          </p>
        </section>

        <!-- Los productos: la API les pone precio para que cuadre con el total. -->
        <div class="tabla-envoltorio">
          <table class="tabla lineal productos">
            <thead>
              <tr>
                <th class="clave">Clave SAT</th>
                <th>Producto</th>
                <th class="cantidad">Cantidad</th>
                <th class="num">P. unitario</th>
                <th class="num">IVA</th>
                <th class="num">Importe</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in renglones" :key="r.clave" class="captura">
                <td class="clave">
                  <template v-if="porId.get(r.productoId)">
                    {{ porId.get(r.productoId)!.claveProdServ }}
                    <span v-if="porId.get(r.productoId)!.claveGenerica" class="generica">
                      genérica
                    </span>
                  </template>
                  <template v-else>—</template>
                </td>
                <td>
                  <select v-model="r.productoId" class="form-input" aria-label="Producto">
                    <option value="" disabled>Elige un producto</option>
                    <option v-for="p in disponibles(r)" :key="p.id" :value="p.id">
                      {{ p.nombre }}
                    </option>
                  </select>
                </td>
                <td class="cantidad">
                  <input
                    v-model="r.cantidad"
                    class="form-input monto"
                    :class="{ 'is-invalid': errorCantidad(r) }"
                    type="text"
                    inputmode="decimal"
                    autocomplete="off"
                    placeholder="0"
                    aria-label="Cantidad"
                  />
                  <span v-if="errorCantidad(r)" class="error-celda">{{ errorCantidad(r) }}</span>
                </td>
                <td class="num">
                  {{ concepto(r) ? dinero(Number(concepto(r)!.valorUnitario)) : '—' }}
                </td>
                <td class="num">
                  <template v-if="concepto(r)">
                    {{ concepto(r)!.tasaIva === 'DIECISEIS' ? '16%' : '0%' }}
                    {{ dinero(concepto(r)!.iva) }}
                  </template>
                  <template v-else>—</template>
                </td>
                <td class="num importe">
                  {{ concepto(r) ? dinero(concepto(r)!.total) : '—' }}
                </td>
                <td class="acciones">
                  <button
                    type="button"
                    class="quitar"
                    title="Quitar"
                    aria-label="Quitar el producto"
                    @click="quitarRenglon(r)"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <button
          type="button"
          class="btn-secondary agregar"
          :disabled="todosElegidos"
          @click="agregarRenglon"
        >
          + Agregar producto
        </button>

        <p v-if="errorVista" class="form-error">{{ errorVista }}</p>

        <!-- Los totales que cuadró la API; el total es la suma de los depósitos. -->
        <dl class="totales">
          <div>
            <dt>Subtotal</dt>
            <dd>{{ vista ? dinero(vista.subtotal) : '—' }}</dd>
          </div>
          <div>
            <dt>IVA</dt>
            <dd>{{ vista ? dinero(vista.iva) : '—' }}</dd>
          </div>
          <div class="fuerte">
            <dt>Total</dt>
            <dd>{{ total !== null ? dinero(total) : '—' }}</dd>
          </div>
        </dl>
        <p class="form-hint">
          {{
            calculando
              ? 'Calculando precios…'
              : 'Los precios los calcula el sistema para que la factura dé exactamente el total.'
          }}
        </p>

        <p v-if="errorEnvio" class="form-error">{{ errorEnvio }}</p>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" :disabled="enviando" @click="emit('cerrar')">
            Cancelar
          </button>
          <button type="submit" class="btn-primary" :disabled="!puedeTimbrar">
            {{ enviando ? 'Timbrando…' : 'Generar factura' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
/* La tabla de productos no cabe en la columna de cliente: la hoja toma el ancho del admin. */
.modal-sheet.ancha {
  max-width: var(--ancho-admin);
}

.modal-texto {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--ink);
}

.aviso-demo {
  margin: 0 0 12px;
  padding: 9px 12px;
  border-radius: 11px;
  background: var(--cream-2);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11.5px;
  color: var(--terracotta-dark);
}

.seccion {
  margin: 0 0 8px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--muted);
}

/* Lo fijo: texto plano con borde punteado, para que no parezca un campo. */
.fijos {
  border: 1px dashed var(--line);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  margin-bottom: 12px;
}

.fijos dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px 16px;
  margin: 0;
}

.fijos dt {
  font-size: 11px;
  color: var(--muted);
}

.fijos dd {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}

.zona-captura {
  background: var(--cream-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  margin-bottom: 12px;
}

.rejilla {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0 12px;
}

.rejilla .ancho {
  grid-column: span 3;
}

.campo {
  min-width: 0;
}

.zona-captura .form-input,
.captura .form-input {
  display: block;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  margin: 0;
  background: var(--white);
  /* 16px reales: con menos, Safari en iPhone amplía la página al enfocar. */
  font-size: 16px;
}

.captura .form-input {
  padding: 6px 8px;
}

.form-hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--muted);
}

.productos {
  min-width: 720px;
}

.tabla .captura td {
  background: var(--cream-2);
  vertical-align: middle;
}

.tabla .clave {
  width: 92px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.generica {
  display: block;
  font-size: 10px;
  color: var(--muted);
}

.tabla .cantidad {
  width: 90px;
}

.monto {
  text-align: right;
  font-weight: 700;
}

.error-celda {
  display: block;
  margin-top: 2px;
  font-size: 10.5px;
  color: var(--rojo);
  white-space: normal;
}

.tabla .acciones {
  width: 1%;
  text-align: right;
}

.quitar {
  border: none;
  background: none;
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
  padding: 2px 6px;
}

.quitar:hover {
  color: var(--rojo);
}

.agregar {
  margin: 10px 0 0;
}

.totales {
  display: grid;
  gap: 4px;
  max-width: 280px;
  margin: 12px 0 0 auto;
}

.totales div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: var(--ink);
}

.totales dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.totales .fuerte {
  border-top: 1px solid var(--line);
  padding-top: 4px;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 16px;
}

.form-error {
  margin: 8px 0 0;
}

@media (max-width: 600px) {
  .rejilla {
    grid-template-columns: minmax(0, 1fr);
  }

  .rejilla .ancho {
    grid-column: auto;
  }
}
</style>
