<script setup lang="ts">
/**
 * Administración → Finanzas → Bancos: el estado de cuenta de cada cuenta
 * bancaria del negocio, mes por mes.
 *
 * Primero se elige la cuenta (las que se dieron de alta en Configuración →
 * Datos bancarios) y luego el periodo. «Abrir periodo» abre cualquier mes de
 * cualquier año: con un mes antes puede heredar su saldo final o empezar en
 * uno escrito; sin ninguno antes, el saldo inicial se escribe. Los saldos los
 * encadena la API. Dentro del periodo, «+ Agregar
 * movimiento» abre un renglón debajo del último para escribir el siguiente.
 *
 * La cantidad lleva signo: lo que sale del banco va en negativo. El saldo lo
 * suma la API; aquí no se suma nada.
 *
 * El 🌐 de arriba de la tabla pone una casilla en los depósitos sin factura:
 * en cuanto se palomea uno, la suma (hecha en la API) aparece debajo de la
 * tabla y «Factura global» lo timbra a PÚBLICO EN GENERAL. El folio queda en
 * la columna Factura y la factura, con su PDF y su XML, en la tabla de
 * facturas globales del mes.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { descargarArchivo, ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, nombreMetodoPago } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import VisorPdfFactura from '@/components/VisorPdfFactura.vue'
import PestanasFinanzas from './finanzas/PestanasFinanzas.vue'
import FacturaGlobalModal from './finanzas/FacturaGlobalModal.vue'
import { cantidadBancaria, errorDeCantidad } from './finanzas/bancos'
import type {
  CuentaBanco,
  EstadoCuentaBanco,
  FacturaGlobal,
  MetodoPago,
  MovimientoBancario,
  PeriodoBancario,
  VistaFacturaGlobal,
} from '@/api/tipos'

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

const METODOS: MetodoPago[] = ['TRANSFERENCIA', 'EFECTIVO']

/** La última cuenta elegida se recuerda en este navegador: casi siempre es la misma. */
const CLAVE_CUENTA = 'rapidix.bancos.cuenta'

function nombrePeriodo(p: { anio: number; mes: number }): string {
  return `${MESES[p.mes - 1]} ${p.anio}`
}

/** `2026-09-01` → `01-sep`, como en el estado de cuenta del banco. */
function fechaCorta(dia: string): string {
  const [, mes, d] = dia.split('-').map(Number)
  return `${String(d).padStart(2, '0')}-${MESES[mes - 1].slice(0, 3).toLowerCase()}`
}

const cuentas = ref<CuentaBanco[]>([])
const cuentaId = ref('')
const estado = ref<EstadoCuentaBanco | null>(null)
const periodoId = ref('')
const periodo = ref<PeriodoBancario | null>(null)
const cargando = ref(true)
const cargandoCuenta = ref(false)
const cargandoPeriodo = ref(false)

onMounted(async () => {
  try {
    cuentas.value = await http.get<CuentaBanco[]>('/admin/finanzas/bancos/cuentas')
    let recordada = ''
    try {
      recordada = localStorage.getItem(CLAVE_CUENTA) ?? ''
    } catch {
      // Almacenamiento bloqueado: se empieza por la primera.
    }
    const inicial = cuentas.value.find((c) => c.id === recordada) ?? cuentas.value[0]
    if (inicial) {
      cuentaId.value = inicial.id
      await cargarCuenta()
    }
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
})

/** Cambiar de cuenta y de periodo deprisa deja respuestas viejas en el aire: gana la última. */
let peticion = 0

/** Lee la cuenta y abre su periodo más reciente, o el que se pida. */
async function cargarCuenta(abrir?: string): Promise<void> {
  const numero = ++peticion
  try {
    localStorage.setItem(CLAVE_CUENTA, cuentaId.value)
  } catch {
    // Sin almacenamiento solo se pierde el recuerdo.
  }
  capturando.value = false
  // Otra cuenta: lo de la anterior se quita ya. Si se quedara mientras llega
  // la respuesta, «Abrir periodo» propondría el saldo heredado de la otra.
  if (estado.value?.cuenta.id !== cuentaId.value) {
    estado.value = null
    periodo.value = null
  }
  cargandoCuenta.value = true
  try {
    const respuesta = await http.get<EstadoCuentaBanco>(
      `/admin/finanzas/bancos/cuentas/${cuentaId.value}`,
    )
    if (numero !== peticion) return
    estado.value = respuesta
    cargandoCuenta.value = false
    periodoId.value = abrir ?? respuesta.periodos[0]?.id ?? ''
    periodo.value = null
    if (periodoId.value) await cargarPeriodo()
  } catch (fallo) {
    if (numero === peticion) {
      cargandoCuenta.value = false
      ui.errorDeApi(fallo)
    }
  }
}

async function cargarPeriodo(): Promise<void> {
  const numero = ++peticion
  capturando.value = false
  cargandoPeriodo.value = true
  try {
    const respuesta = await http.get<PeriodoBancario>(
      `/admin/finanzas/bancos/periodos/${periodoId.value}`,
    )
    if (numero === peticion) periodo.value = respuesta
  } catch (fallo) {
    if (numero === peticion) ui.errorDeApi(fallo)
  } finally {
    if (numero === peticion) cargandoPeriodo.value = false
  }
}

const cuenta = computed(() => estado.value?.cuenta ?? null)

// ------------------------------------------------------------------
// Abrir periodo
// ------------------------------------------------------------------

const abriendo = ref(false)
const nuevoMes = ref(1)
const nuevoAnio = ref('')
/** Texto y no número: el campo vacío no es cero. */
const saldoInicial = ref('')
/** Con un mes antes, si se escribe otro saldo en vez de heredar el suyo. */
const escribirSaldo = ref(false)
const errorAbrir = ref('')
const guardandoPeriodo = ref(false)

/** El año del modal como número, o null mientras no sea uno válido. */
const anioElegido = computed(() => {
  const anio = Number(nuevoAnio.value)
  return Number.isInteger(anio) && anio >= 2000 && anio <= 2100 ? anio : null
})

/**
 * El periodo abierto más cercano antes del mes elegido: de él se hereda. No
 * se suma nada aquí; su saldo final lo trae la API en el resumen.
 */
const periodoAnterior = computed(() => {
  const anio = anioElegido.value
  if (anio === null) return null
  // `periodos` llega del más reciente al más viejo: el primero que cae antes.
  return (
    estado.value?.periodos.find(
      (p) => p.anio < anio || (p.anio === anio && p.mes < nuevoMes.value),
    ) ?? null
  )
})

/** El mes elegido ya está abierto: se avisa antes de mandarlo. */
const yaAbierto = computed(() =>
  (estado.value?.periodos ?? []).some(
    (p) => p.anio === anioElegido.value && p.mes === nuevoMes.value,
  ),
)

const pideSaldo = computed(() => !periodoAnterior.value || escribirSaldo.value)

function abrirModal(): void {
  if (!estado.value) return
  nuevoMes.value = estado.value.siguiente.mes
  nuevoAnio.value = String(estado.value.siguiente.anio)
  saldoInicial.value = ''
  escribirSaldo.value = false
  errorAbrir.value = ''
  abriendo.value = true
}

async function abrirPeriodo(): Promise<void> {
  errorAbrir.value = ''
  const anio = anioElegido.value
  if (anio === null) {
    errorAbrir.value = 'Escribe un año válido.'
    return
  }
  if (yaAbierto.value) {
    errorAbrir.value = `${nombrePeriodo({ anio, mes: nuevoMes.value })} ya está abierto.`
    return
  }
  let saldo: number | undefined
  if (pideSaldo.value) {
    const error = errorDeCantidad(saldoInicial.value, 'el saldo inicial de la cuenta')
    if (error) {
      errorAbrir.value = error
      return
    }
    saldo = cantidadBancaria(saldoInicial.value)!
  }

  guardandoPeriodo.value = true
  try {
    const abierto = await http.post<PeriodoBancario>(
      `/admin/finanzas/bancos/cuentas/${cuentaId.value}/periodos`,
      { anio, mes: nuevoMes.value, ...(saldo !== undefined && { saldoInicial: saldo }) },
    )
    abriendo.value = false
    ui.exito(`${nombrePeriodo(abierto)} abierto`)
    await cargarCuenta(abierto.id)
  } catch (fallo) {
    errorAbrir.value = fallo instanceof ErrorApi ? fallo.message : 'No se pudo abrir el periodo.'
  } finally {
    guardandoPeriodo.value = false
  }
}

// ------------------------------------------------------------------
// Agregar movimiento: un renglón debajo del último
// ------------------------------------------------------------------

const capturando = ref(false)
const nuevo = ref({
  fecha: '',
  factura: '',
  cantidad: '',
  metodo: 'TRANSFERENCIA' as MetodoPago,
  referencia: '',
})
const errorMovimiento = ref('')
const guardandoMovimiento = ref(false)
const campoFecha = ref<HTMLInputElement | null>(null)

/** Los límites del campo de fecha: el primer y el último día del mes del periodo. */
const limites = computed(() => {
  if (!periodo.value) return { min: '', max: '' }
  const { anio, mes } = periodo.value
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  const base = `${anio}-${String(mes).padStart(2, '0')}`
  return { min: `${base}-01`, max: `${base}-${ultimo}` }
})

async function empezarCaptura(): Promise<void> {
  if (!periodo.value) return
  // La fecha del último renglón: los movimientos se capturan en orden.
  const anterior = periodo.value.movimientos.at(-1)
  nuevo.value = {
    fecha: anterior?.fecha ?? limites.value.min,
    factura: '',
    cantidad: '',
    metodo: anterior?.metodo ?? 'TRANSFERENCIA',
    referencia: '',
  }
  errorMovimiento.value = ''
  capturando.value = true
  await nextTick()
  campoFecha.value?.focus()
}

/** El teclado decimal del iPhone no trae el signo menos: este botón lo pone y lo quita. */
function cambiarSigno(): void {
  // El menos puede venir después del `$` («$-6,750»): se quita donde esté.
  const valor = nuevo.value.cantidad.trim()
  const sinSigno = valor.replace(/-/g, '')
  nuevo.value.cantidad = valor.includes('-') ? sinSigno : `-${sinSigno}`
}

/**
 * La respuesta de un guardado o un borrado es del periodo en el que se hizo:
 * si mientras tanto se eligió otro periodo u otra cuenta, no se pinta encima.
 */
function sigueEnPantalla(id: string): boolean {
  return periodoId.value === id && periodo.value?.id === id
}

async function guardarMovimiento(): Promise<void> {
  if (!periodo.value || guardandoMovimiento.value) return
  errorMovimiento.value = ''
  if (!nuevo.value.fecha) {
    errorMovimiento.value = 'Escribe la fecha.'
    return
  }
  const error = errorDeCantidad(nuevo.value.cantidad, 'la cantidad; si sale del banco, en negativo')
  if (error) {
    errorMovimiento.value = error
    return
  }
  const cantidad = cantidadBancaria(nuevo.value.cantidad)!
  if (cantidad === 0) {
    errorMovimiento.value = 'La cantidad no puede ser cero.'
    return
  }

  const id = periodo.value.id
  guardandoMovimiento.value = true
  try {
    const respuesta = await http.post<PeriodoBancario>(
      `/admin/finanzas/bancos/periodos/${id}/movimientos`,
      {
        fecha: nuevo.value.fecha,
        cantidad,
        metodo: nuevo.value.metodo,
        ...(nuevo.value.factura.trim() && { factura: nuevo.value.factura.trim() }),
        ...(nuevo.value.referencia.trim() && { referencia: nuevo.value.referencia.trim() }),
      },
    )
    if (sigueEnPantalla(id)) {
      periodo.value = respuesta
      capturando.value = false
    }
    void refrescarResumen(respuesta.cuentaId)
  } catch (fallo) {
    // Se cambió de periodo: el renglón ya no está a la vista para corregirlo.
    if (!sigueEnPantalla(id)) ui.errorDeApi(fallo)
    else {
      errorMovimiento.value =
        fallo instanceof ErrorApi ? fallo.message : 'No se pudo guardar el movimiento.'
    }
  } finally {
    guardandoMovimiento.value = false
  }
}

async function eliminarMovimiento(movimientoId: string): Promise<void> {
  if (!periodo.value || !confirm('¿Eliminar este movimiento?')) return
  const id = periodo.value.id
  try {
    const respuesta = await http.delete<PeriodoBancario>(
      `/admin/finanzas/bancos/movimientos/${movimientoId}`,
    )
    if (sigueEnPantalla(id)) periodo.value = respuesta
    void refrescarResumen(respuesta.cuentaId)
  } catch (fallo) {
    ui.errorDeApi(fallo)
  }
}

/**
 * Un movimiento cambia el saldo de este mes y el inicial de los siguientes:
 * se relee la cuenta para que el próximo «Abrir periodo» herede lo vigente.
 * Solo si sigue siendo la cuenta elegida: si no, el modal propondría el saldo
 * de otra.
 */
async function refrescarResumen(cuenta: string): Promise<void> {
  try {
    const respuesta = await http.get<EstadoCuentaBanco>(`/admin/finanzas/bancos/cuentas/${cuenta}`)
    if (cuentaId.value === cuenta && !cargandoCuenta.value) estado.value = respuesta
  } catch {
    // No estorba: se vuelve a leer al abrir el siguiente periodo.
  }
}

// ------------------------------------------------------------------
// Facturación global: palomear depósitos y timbrarlos juntos
// ------------------------------------------------------------------

/** Las casillas solo salen con el 🌐 de arriba de la tabla encendido. */
const seleccionando = ref(false)
const seleccion = ref<string[]>([])
/** La suma de lo palomeado, hecha por la API. */
const sumaSeleccion = ref<number | null>(null)
const facturandoGlobal = ref(false)
const visor = ref<{ id: string; folio: string } | null>(null)

/** Solo los depósitos sin factura: lo que sale del banco no se factura. */
function facturable(m: MovimientoBancario): boolean {
  return m.cantidad > 0 && !m.factura && !m.facturaGlobalId
}

const facturables = computed(() => (periodo.value?.movimientos ?? []).filter(facturable))
const todosPalomeados = computed(
  () => facturables.value.length > 0 && seleccion.value.length === facturables.value.length,
)

function alternarSeleccion(): void {
  seleccionando.value = !seleccionando.value
  seleccion.value = []
}

function palomearTodos(marcar: boolean): void {
  seleccion.value = marcar ? facturables.value.map((m) => m.id) : []
}

// Otro periodo u otra cuenta: lo palomeado era de la tabla anterior.
watch(periodoId, () => {
  seleccion.value = []
})

/** Palomear deprisa deja sumas viejas en el aire: gana la última. */
let peticionSuma = 0

// `deep`: las casillas con v-model meten y sacan del mismo arreglo.
watch(
  seleccion,
  async (ids) => {
    const numero = ++peticionSuma
    if (ids.length === 0) {
      sumaSeleccion.value = null
      return
    }
    try {
      const vista = await http.post<VistaFacturaGlobal>(
        '/admin/finanzas/bancos/factura-global/previsualizar',
        { movimientoIds: [...ids], renglones: [] },
      )
      if (numero === peticionSuma) sumaSeleccion.value = vista.total
    } catch (fallo) {
      if (numero !== peticionSuma) return
      sumaSeleccion.value = null
      ui.errorDeApi(fallo)
    }
  },
  { deep: true },
)

async function alFacturar(factura: FacturaGlobal | null): Promise<void> {
  facturandoGlobal.value = false
  seleccionando.value = false
  seleccion.value = []
  if (factura) {
    ui.exito(`Factura global ${factura.folioMovimientos} generada`)
    visor.value = { id: factura.id, folio: factura.folioMovimientos }
  }
  const cuenta = periodo.value?.cuentaId
  await cargarPeriodo()
  if (cuenta) void refrescarResumen(cuenta)
  void cargarFacturasGlobales()
}

// ------------------------------------------------------------------
// Las facturas globales del periodo, con su PDF y su XML
// ------------------------------------------------------------------

const facturasGlobales = ref<FacturaGlobal[]>([])
const descargando = ref<string | null>(null)
/** Cambiar de periodo deprisa deja listas viejas en el aire: gana la última. */
let peticionFacturas = 0

async function cargarFacturasGlobales(): Promise<void> {
  const numero = ++peticionFacturas
  const id = periodo.value?.id
  if (!id) {
    facturasGlobales.value = []
    return
  }
  try {
    const respuesta = await http.get<FacturaGlobal[]>(
      `/admin/finanzas/bancos/factura-global?periodoId=${id}`,
    )
    if (numero === peticionFacturas) facturasGlobales.value = respuesta
  } catch (fallo) {
    if (numero === peticionFacturas) ui.errorDeApi(fallo)
  }
}

// Solo al cambiar de periodo: guardar o borrar un movimiento no cambia las facturas.
watch(() => periodo.value?.id, cargarFacturasGlobales)

async function descargarXml(factura: FacturaGlobal): Promise<void> {
  if (descargando.value) return
  descargando.value = factura.id
  try {
    await descargarArchivo(
      `/admin/finanzas/bancos/factura-global/${factura.id}/xml`,
      `factura-global-${factura.folioMovimientos}.xml`,
    )
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    descargando.value = null
  }
}

/** `2026-10-23T…` → `23-oct-2026`: el día en que se timbró, en la hora de México. */
function fechaTimbrado(iso: string): string {
  const fecha = new Date(iso)
  const dia = fecha.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
  return `${fechaCorta(dia)}-${dia.slice(0, 4)}`
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <PestanasFinanzas activa="bancos" />

    <SkeletonList v-if="cargando" :cantidad="3" />

    <p v-else-if="cuentas.length === 0" class="empty-block">
      No hay cuentas bancarias. Dalas de alta en Configuración → Datos bancarios.
    </p>

    <template v-else>
      <!-- Bloque crema y campos blancos: se ve dónde se elige. -->
      <div class="filtros">
        <div class="campo">
          <label class="form-label" for="bancos-cuenta">Cuenta bancaria</label>
          <select id="bancos-cuenta" v-model="cuentaId" class="form-input" @change="cargarCuenta()">
            <option v-for="c in cuentas" :key="c.id" :value="c.id">
              {{ c.banco }} · {{ c.numeroCuenta }} · {{ c.titular }}
            </option>
          </select>
        </div>
        <div class="campo">
          <label class="form-label" for="bancos-periodo">Periodo</label>
          <select
            id="bancos-periodo"
            v-model="periodoId"
            class="form-input"
            :disabled="!estado || estado.periodos.length === 0"
            @change="cargarPeriodo"
          >
            <option v-if="!estado || estado.periodos.length === 0" value="">Sin periodos</option>
            <option v-for="p in estado?.periodos ?? []" :key="p.id" :value="p.id">
              {{ nombrePeriodo(p) }}
            </option>
          </select>
        </div>
        <button type="button" class="btn-secondary abrir" :disabled="!estado" @click="abrirModal">
          Abrir periodo
        </button>
      </div>

      <p v-if="estado && estado.periodos.length === 0" class="empty-block">
        {{ cuenta?.banco }} todavía no tiene periodos. Ábrelo con su saldo inicial.
      </p>

      <SkeletonList v-else-if="(cargandoCuenta || cargandoPeriodo) && !periodo" :cantidad="3" />

      <template v-else-if="periodo">
        <div class="cabecera">
          <div>
            <span class="titulo-dato">Mes</span>
            <strong>{{ nombrePeriodo(periodo) }}</strong>
          </div>
          <div class="saldo-inicial">
            <span class="titulo-dato">
              Saldo inicial · {{ periodo.saldoInicialEscrito ? 'escrito' : 'del mes anterior' }}
            </span>
            <strong>{{ dinero(periodo.saldoInicial) }}</strong>
          </div>
          <!-- Enciende las casillas para palomear depósitos de la factura global. -->
          <button
            type="button"
            class="mundo"
            :class="{ activo: seleccionando }"
            :aria-pressed="seleccionando"
            :title="seleccionando ? 'Cancelar la selección' : 'Facturación global'"
            :aria-label="seleccionando ? 'Cancelar la selección' : 'Facturación global'"
            @click="alternarSeleccion"
          >
            🌐
          </button>
        </div>

        <div class="tabla-envoltorio">
          <table class="tabla lineal movimientos">
            <thead>
              <tr>
                <th v-if="seleccionando" class="casilla">
                  <input
                    type="checkbox"
                    :checked="todosPalomeados"
                    :disabled="facturables.length === 0"
                    aria-label="Palomear todos los depósitos sin factura"
                    @change="palomearTodos(($event.target as HTMLInputElement).checked)"
                  />
                </th>
                <th class="fecha">Fecha</th>
                <th class="factura">Factura</th>
                <th class="num">Cantidad</th>
                <th class="metodo">Método de pago</th>
                <th>Referencia</th>
                <th class="acciones" aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="m in periodo.movimientos"
                :key="m.id"
                :class="{ palomeado: seleccion.includes(m.id) }"
              >
                <td v-if="seleccionando" class="casilla">
                  <input
                    v-if="facturable(m)"
                    v-model="seleccion"
                    type="checkbox"
                    :value="m.id"
                    :aria-label="`Facturar el depósito del ${fechaCorta(m.fecha)}`"
                  />
                </td>
                <td class="fecha">{{ fechaCorta(m.fecha) }}</td>
                <td class="factura">
                  <!-- La factura global timbrada se abre desde su folio. -->
                  <button
                    v-if="m.facturaGlobalId"
                    type="button"
                    class="enlace"
                    :title="`Ver la factura global ${m.factura}`"
                    @click="visor = { id: m.facturaGlobalId, folio: m.factura ?? '' }"
                  >
                    {{ m.factura }}
                  </button>
                  <template v-else>{{ m.factura ?? '—' }}</template>
                </td>
                <td class="num importe" :class="{ negativo: m.cantidad < 0 }">
                  {{ dinero(m.cantidad) }}
                </td>
                <td class="metodo">{{ nombreMetodoPago(m.metodo) }}</td>
                <td>{{ m.referencia ?? '' }}</td>
                <td class="acciones">
                  <!-- Un depósito dentro de una factura global ya no se borra. -->
                  <button
                    v-if="!m.facturaGlobalId"
                    type="button"
                    class="quitar"
                    :aria-label="`Eliminar el movimiento del ${fechaCorta(m.fecha)}`"
                    title="Eliminar"
                    @click="eliminarMovimiento(m.id)"
                  >
                    ✕
                  </button>
                </td>
              </tr>

              <!-- El renglón que se está escribiendo, debajo del último. -->
              <tr v-if="capturando" class="captura">
                <td v-if="seleccionando" class="casilla" />
                <td class="fecha">
                  <input
                    ref="campoFecha"
                    v-model="nuevo.fecha"
                    class="form-input"
                    type="date"
                    :min="limites.min"
                    :max="limites.max"
                    aria-label="Fecha"
                  />
                </td>
                <td class="factura">
                  <input
                    v-model="nuevo.factura"
                    class="form-input"
                    type="text"
                    maxlength="8"
                    placeholder="A1127"
                    aria-label="Factura"
                  />
                </td>
                <td>
                  <span class="cantidad">
                    <button
                      type="button"
                      class="signo"
                      title="Cambiar el signo"
                      aria-label="Cambiar el signo"
                      @click="cambiarSigno"
                    >
                      ±
                    </button>
                    <input
                      v-model="nuevo.cantidad"
                      class="form-input monto"
                      type="text"
                      inputmode="decimal"
                      autocomplete="off"
                      placeholder="0.00"
                      aria-label="Cantidad"
                      @keyup.enter="guardarMovimiento"
                    />
                  </span>
                </td>
                <td class="metodo">
                  <select v-model="nuevo.metodo" class="form-input" aria-label="Método de pago">
                    <option v-for="metodo in METODOS" :key="metodo" :value="metodo">
                      {{ nombreMetodoPago(metodo) }}
                    </option>
                  </select>
                </td>
                <td>
                  <input
                    v-model="nuevo.referencia"
                    class="form-input"
                    type="text"
                    maxlength="200"
                    placeholder="Texto libre"
                    aria-label="Referencia"
                    @keyup.enter="guardarMovimiento"
                  />
                </td>
                <td />
              </tr>

              <tr v-if="periodo.movimientos.length === 0 && !capturando">
                <td :colspan="seleccionando ? 7 : 6" class="vacio">
                  Sin movimientos en {{ nombrePeriodo(periodo) }}.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p v-if="errorMovimiento" class="form-error">{{ errorMovimiento }}</p>

        <div class="botones">
          <template v-if="capturando">
            <button
              type="button"
              class="btn-cancel"
              :disabled="guardandoMovimiento"
              @click="capturando = false"
            >
              Cancelar
            </button>
            <button
              type="button"
              class="btn-primary"
              :disabled="guardandoMovimiento"
              @click="guardarMovimiento"
            >
              {{ guardandoMovimiento ? 'Guardando…' : 'Guardar movimiento' }}
            </button>
          </template>
          <button v-else type="button" class="btn-secondary" @click="empezarCaptura">
            + Agregar movimiento
          </button>
        </div>

        <!-- Lo palomeado, sumado por la API, y el botón que abre la factura. -->
        <div v-if="seleccion.length > 0" class="seleccion">
          <div>
            <span class="titulo-dato">
              {{ seleccion.length }} {{ seleccion.length === 1 ? 'depósito' : 'depósitos' }}
            </span>
            <strong>{{ sumaSeleccion !== null ? dinero(sumaSeleccion) : '—' }}</strong>
          </div>
          <button
            type="button"
            class="btn-primary"
            :disabled="seleccion.length === 0 || sumaSeleccion === null"
            @click="facturandoGlobal = true"
          >
            🌐 Factura global
          </button>
        </div>

        <!-- El saldo que sumó la API: el inicial más todo lo del mes. -->
        <div class="total" :class="{ negativo: periodo.saldo < 0 }">
          <span class="total-titulo">Saldo:</span>
          <strong class="total-monto">{{ dinero(periodo.saldo) }}</strong>
        </div>

        <!-- Las facturas globales de los depósitos de este mes, con sus archivos. -->
        <p class="titulo-dato facturas-titulo">🌐 Facturas globales</p>
        <div class="tabla-envoltorio">
          <table class="tabla lineal facturas">
            <thead>
              <tr>
                <th class="factura">Factura</th>
                <th class="fecha">Timbrada</th>
                <th>Folio fiscal</th>
                <th class="num">Total</th>
                <th class="archivos">Archivos</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="f in facturasGlobales" :key="f.id">
                <td class="factura">{{ f.folioMovimientos }}</td>
                <td class="fecha">{{ fechaTimbrado(f.timbradaEn) }}</td>
                <td class="uuid">{{ f.uuid }}</td>
                <td class="num importe">{{ dinero(f.total) }}</td>
                <td class="archivos">
                  <button
                    type="button"
                    class="enlace"
                    @click="visor = { id: f.id, folio: f.folioMovimientos }"
                  >
                    PDF
                  </button>
                  <button
                    type="button"
                    class="enlace"
                    :disabled="descargando !== null"
                    @click="descargarXml(f)"
                  >
                    {{ descargando === f.id ? 'Descargando…' : 'XML' }}
                  </button>
                </td>
              </tr>
              <tr v-if="facturasGlobales.length === 0">
                <td colspan="5" class="vacio">
                  Sin facturas globales en {{ nombrePeriodo(periodo) }}.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>

    <FacturaGlobalModal
      v-if="facturandoGlobal && periodo"
      :movimiento-ids="seleccion"
      :periodo="periodo"
      @cerrar="facturandoGlobal = false"
      @facturado="alFacturar"
    />

    <VisorPdfFactura
      v-if="visor"
      :ruta="`/admin/finanzas/bancos/factura-global/${visor.id}/pdf`"
      :nombre="`factura-global-${visor.folio}.pdf`"
      :titulo="`🌐 Factura global ${visor.folio}`"
      @cerrar="visor = null"
    />

    <!-- Abrir periodo: mes, año y el saldo con el que empieza. -->
    <div v-if="abriendo" class="modal-overlay" @click.self="abriendo = false">
      <div class="modal-sheet" role="dialog" aria-label="Abrir periodo">
        <div class="modal-handle" />
        <p class="modal-title">Abrir periodo · {{ cuenta?.banco }}</p>

        <div class="zona-captura">
          <div class="mes-anio">
            <div>
              <label class="form-label" for="periodo-mes">Mes</label>
              <select id="periodo-mes" v-model="nuevoMes" class="form-input">
                <option v-for="(nombre, i) in MESES" :key="nombre" :value="i + 1">
                  {{ nombre }}
                </option>
              </select>
            </div>
            <div>
              <label class="form-label" for="periodo-anio">Año</label>
              <input
                id="periodo-anio"
                v-model="nuevoAnio"
                class="form-input"
                type="text"
                inputmode="numeric"
                maxlength="4"
              />
            </div>
          </div>

          <p v-if="yaAbierto" class="form-error">
            {{ nombrePeriodo({ anio: anioElegido!, mes: nuevoMes }) }} ya está abierto en esta
            cuenta.
          </p>

          <template v-else-if="periodoAnterior">
            <p class="heredado">
              Saldo final de {{ nombrePeriodo(periodoAnterior) }}:
              <strong>{{ dinero(periodoAnterior.saldoFinal) }}</strong>
            </p>
            <label class="opcion">
              <input v-model="escribirSaldo" type="checkbox" />
              Empezar con otro saldo inicial
            </label>
          </template>

          <template v-if="pideSaldo && !yaAbierto">
            <label class="form-label" for="periodo-saldo">Saldo inicial</label>
            <input
              id="periodo-saldo"
              v-model="saldoInicial"
              class="form-input monto"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              placeholder="0.00"
              @keyup.enter="abrirPeriodo"
            />
          </template>
        </div>

        <p v-if="errorAbrir" class="form-error">{{ errorAbrir }}</p>

        <div class="modal-actions">
          <button
            type="button"
            class="btn-cancel"
            :disabled="guardandoPeriodo"
            @click="abriendo = false"
          >
            Volver
          </button>
          <button
            type="button"
            class="btn-primary"
            :disabled="guardandoPeriodo || yaAbierto"
            @click="abrirPeriodo"
          >
            {{ guardandoPeriodo ? 'Abriendo…' : 'Abrir periodo' }}
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

/* Igual que los filtros de Ingresos: la cuenta a todo lo ancho, el periodo y
   «Abrir periodo» debajo. `minmax(0, 1fr)` para que nada empuje la rejilla. */
.filtros {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: end;
  gap: 10px 12px;
  background: var(--cream-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  margin-bottom: 12px;
}

.filtros .campo:first-child {
  grid-column: 1 / -1;
}

.campo {
  min-width: 0;
}

.campo .form-label {
  margin-top: 0;
}

.campo .form-input {
  display: block;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  margin: 0;
  background: var(--white);
}

.abrir {
  width: 100%;
}

.cabecera {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--ink);
}

/* El saldo inicial al centro, entre el mes y el 🌐. */
.cabecera .saldo-inicial {
  text-align: center;
}

/* El 🌐 hasta la derecha: encendido, en terracota, mientras se palomea. */
.mundo {
  flex-shrink: 0;
  align-self: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--white);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.mundo.activo {
  background: var(--terracotta);
  border-color: var(--terracotta);
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

/* Menos aire entre columnas que en las tablas de pedidos: aquí los datos son cortos. */
.tabla.lineal > thead > tr > th,
.tabla.lineal > tbody > tr > td {
  padding-left: 8px;
  padding-right: 8px;
}

/* Fecha, factura, cantidad y método miden lo que su contenido (`width: 1%` encoge la
   columna al mínimo); el espacio que sobra se lo queda la referencia, que es texto libre. */
.tabla .fecha,
.tabla .factura,
.tabla .num,
.tabla .metodo {
  width: 1%;
  white-space: nowrap;
}

.tabla .fecha {
  font-variant-numeric: tabular-nums;
}

/* Lo que sale del banco salta a la vista, como el renglón amarillo del Excel. */
.tabla .negativo {
  color: var(--rojo);
}

.tabla .acciones {
  width: 1%;
  text-align: right;
}

.tabla .casilla {
  width: 1%;
  text-align: center;
}

/* Columnas de ancho fijo: el renglón que se captura trae campos más anchos que
   el texto (en el teléfono, el de fecha sobre todo) y, con el ancho automático,
   al abrirlo ensanchaba las columnas y recorría los encabezados y las filas de
   arriba. La referencia se queda con lo que sobra. */
.movimientos {
  min-width: 820px;
  table-layout: fixed;
}

/* Con el ancho fijo, una referencia larga se corta en vez de pisar la columna de al lado. */
.movimientos > tbody > tr:not(.captura) > td {
  overflow: hidden;
  text-overflow: ellipsis;
}

.movimientos .casilla,
.movimientos .acciones {
  width: 40px;
}

.movimientos .fecha {
  width: 150px;
}

.movimientos .factura {
  width: 100px;
}

.movimientos th.num {
  width: 160px;
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

/* El folio de la factura global se toca para ver su PDF, pero se lee igual que
   los folios escritos a mano: misma letra, color y tamaño. */
.tabla .factura .enlace {
  padding: 0;
  font: inherit;
  color: inherit;
}

.facturas-titulo {
  margin: 16px 0 6px;
}

/* El UUID son 36 caracteres: se parte antes que empujar la tabla. */
.facturas .uuid {
  font-size: 12px;
  color: var(--muted);
  word-break: break-all;
}

.facturas .archivos {
  width: 1%;
  white-space: nowrap;
  text-align: right;
}

.facturas .archivos .enlace {
  padding: 0;
  margin-left: 12px;
}

/* La suma de lo palomeado y su botón, encima del saldo. */
.seleccion {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--cream-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  margin-bottom: 12px;
}

.seleccion strong {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 20px;
  color: var(--ink);
}

.seleccion .btn-primary {
  flex: 0 0 auto;
  width: auto;
  padding: 10px 16px;
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

/* El renglón que se escribe: crema, con los campos blancos. */
.tabla .captura td {
  background: var(--cream-2);
  vertical-align: middle;
}

.captura .form-input {
  display: block;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  margin: 0;
  padding: 6px 8px;
  /* 16px reales: con menos, Safari en iPhone amplía la página al enfocar. */
  font-size: 16px;
  background: var(--white);
}

/* Las columnas miden su contenido: los campos de captura llevan su propio ancho, lo justo
   para el selector de fecha, el folio de 8, el monto y «Transferencia» con su flecha. */
.captura .fecha .form-input {
  width: 140px;
}

.captura .factura .form-input {
  width: calc(8ch + 26px);
}

.captura .monto {
  width: 110px;
}

.captura .metodo .form-input {
  width: 150px;
}

.cantidad {
  display: flex;
  gap: 4px;
}

.signo {
  flex-shrink: 0;
  width: 32px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--white);
  color: var(--ink);
  font-weight: 700;
  cursor: pointer;
}

.monto {
  text-align: right;
  font-weight: 700;
}

.vacio {
  color: var(--muted);
  text-align: center;
}

.botones {
  display: flex;
  justify-content: flex-start;
  gap: 8px;
  margin: 10px 0 12px;
}

.botones .btn-cancel {
  flex: 0 0 auto;
  padding: 9px 14px;
}

.form-error {
  margin: 8px 0 0;
}

/* La misma tarjeta verde del total de Ingresos; en rojo si la cuenta quedó en negativo. */
.total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  background: var(--verde-dark);
  color: var(--white);
  border-radius: var(--radius-md);
  padding: 12px 14px;
}

.total.negativo {
  background: var(--rojo);
}

.total-titulo {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  opacity: 0.85;
}

.total-monto {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 22px;
  white-space: nowrap;
}

/* Donde se escribe: bloque crema y campos blancos. */
.zona-captura {
  background: var(--cream-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  margin-bottom: 12px;
}

.zona-captura .form-input {
  background: var(--white);
  font-size: 16px;
}

.mes-anio {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 10px;
}

.mes-anio .form-input {
  width: 100%;
  box-sizing: border-box;
}

.heredado {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--ink);
}

.opcion {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0 4px;
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
}
</style>
