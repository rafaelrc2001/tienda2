<script setup lang="ts">
/**
 * «Facturar» de Mis pedidos: los datos fiscales del cliente y el timbrado.
 *
 * Finanzas usa la misma hoja (`porFinanzas`) para facturar a nombre del
 * cliente: cambian las rutas —las del panel, que sacan al cliente del
 * pedido— y los textos, que le hablan al personal y no al cliente. Finanzas
 * además elige a nombre de quién sale (las cuentas de factura.com del
 * servidor), con el de la tienda del pedido ya elegido; el cliente no elige.
 *
 * Los catálogos (régimen y uso del CFDI) y lo guardado —aquí o en el Perfil—
 * llegan juntos de `GET /perfil/datos-fiscales`: la interfaz no lleva copia de
 * los catálogos del SAT. Los candados (pagado, una factura por
 * pedido) los pone la API; aquí solo se captura y se enseña lo que responda.
 *
 * Antes de timbrar, «Revisar factura» pide a la API el CFDI armado (conceptos,
 * IVA y, si el negocio es RESICO y el receptor persona moral, la retención de
 * ISR) y lo enseña en la misma hoja; desde ahí se timbra o se corrige.
 *
 * Tocar fuera de la hoja no la cierra: con el formulario a medias se perdía
 * lo capturado por un toque de más. Solo cierra «Cancelar».
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero } from '@/utils/formato'
import {
  aniosValidos,
  esPublicoEnGeneral,
  esRfcGenerico,
  mesesValidos,
  periodoDeLaVenta,
  PUBLICO_EN_GENERAL,
  RFC_GENERICO,
  type PeriodoGlobal,
} from '@/utils/informacionGlobal'
import {
  CAMPOS_FISCALES,
  cuerpoFiscal,
  erroresSinNombreDeCampo,
  formularioFiscalDesde,
  type CampoFiscal,
  type FormularioFiscal,
} from '@/utils/datosFiscales'
import CamposFiscales from '@/components/CamposFiscales.vue'
import VistaPreviaFactura from '@/components/VistaPreviaFactura.vue'
import type {
  DatosFiscalesRespuesta,
  EmisorOpcion,
  FacturaDePedido,
  Pedido,
  VistaFactura,
} from '@/api/tipos'

const props = defineProps<{ pedido: Pedido; porFinanzas?: boolean }>()

/** Las del cliente, o las del panel, que facturan a nombre del cliente del pedido. */
const base = computed(() =>
  props.porFinanzas ? `/admin/finanzas/pedidos/${props.pedido.id}` : null,
)
const rutaDatos = computed(() =>
  base.value ? `${base.value}/datos-fiscales` : '/perfil/datos-fiscales',
)
const rutaFactura = computed(() => `${base.value ?? `/pedidos/${props.pedido.id}`}/factura`)
const emit = defineEmits<{
  (e: 'cerrar'): void
  /** Ya tiene CFDI (o alguien lo timbró mientras tanto): quien abrió relee la lista. */
  (e: 'facturado', factura: FacturaDePedido | null): void
}>()

const ui = useUiStore()
/** En Finanzas trae además con quién se puede emitir y cuál sale elegido. */
const catalogos = ref<
  (DatosFiscalesRespuesta & { emisores?: EmisorOpcion[]; emisorSugerido?: string }) | null
>(null)
const cargando = ref(true)
const enviando = ref(false)
const errores = ref<Partial<Record<CampoFiscal, string>>>({})
const errorFormaPago = ref('')
const erroresGenerales = ref<string[]>([])

const formulario = ref<FormularioFiscal>({
  rfc: '',
  razonSocial: '',
  regimenFiscal: '',
  usoCfdi: 'G03',
  cpFiscal: '',
  email: '',
})
/**
 * Llega con la forma en que se pagó el pedido. Se puede cambiar por otra del
 * catálogo del SAT (pagó con tarjeta en la terminal, por ejemplo) y no se
 * guarda con los datos fiscales: es de este pedido.
 */
const formaPago = ref(props.pedido.formaPagoFactura)
/** Solo Finanzas: RFC con el que se emite. */
const emisorRfc = ref('')
const emisores = computed(() => catalogos.value?.emisores ?? [])

onMounted(async () => {
  try {
    catalogos.value = await http.get<DatosFiscalesRespuesta>(rutaDatos.value)
    formulario.value = formularioFiscalDesde(catalogos.value)
    emisorRfc.value = catalogos.value.emisorSugerido ?? ''
  } catch (fallo) {
    ui.errorDeApi(fallo)
    emit('cerrar')
  } finally {
    cargando.value = false
  }
})

const simulado = computed(() => catalogos.value?.modo === 'SIMULADO')

/**
 * A PÚBLICO EN GENERAL el SAT la trata como factura global y pide el periodo
 * que cubre (CFDI40130). Llega con diario y el mes y año de la venta.
 */
const periodo = ref<PeriodoGlobal>(periodoDeLaVenta(props.pedido.creadoEn))
const errorPeriodo = ref('')
const esGlobal = computed(() =>
  esPublicoEnGeneral(formulario.value.rfc, formulario.value.razonSocial),
)
/** RFC genérico con el nombre de la persona: factura nominativa, sin periodo. */
const genericoNominativo = computed(() => esRfcGenerico(formulario.value.rfc) && !esGlobal.value)
const mesesDelPeriodo = computed(() =>
  mesesValidos(catalogos.value?.meses ?? [], periodo.value.periodicidad),
)
const anios = aniosValidos()

/**
 * El CP de quien factura: a PÚBLICO EN GENERAL es el del receptor (CFDI40149).
 * Solo Finanzas lo sabe; desde Mis pedidos la API lo pone al timbrar.
 */
const cpDelEmisor = computed(
  () => emisores.value.find((e) => e.rfc === emisorRfc.value)?.cp ?? null,
)

/**
 * Al escribir el RFC genérico se llena lo que el SAT exige para PÚBLICO EN
 * GENERAL; el nombre se puede cambiar por el de la persona (nominativa). Al
 * cambiarlo por el RFC de una persona se vacía lo de público en general para
 * que se capturen sus datos. Síncrono para ver `cargando`: lo guardado que
 * llega al abrir no se toca.
 */
watch(
  () => esRfcGenerico(formulario.value.rfc),
  (generico, antes) => {
    if (cargando.value || generico === antes) return
    if (generico) {
      formulario.value = {
        ...formulario.value,
        razonSocial: PUBLICO_EN_GENERAL,
        regimenFiscal: '616',
        usoCfdi: 'S01',
        cpFiscal: cpDelEmisor.value ?? formulario.value.cpFiscal,
      }
    } else if (esPublicoEnGeneral(RFC_GENERICO, formulario.value.razonSocial)) {
      formulario.value = {
        ...formulario.value,
        razonSocial: '',
        regimenFiscal: '',
        usoCfdi: 'G03',
        cpFiscal: '',
      }
    }
  },
  { flush: 'sync' },
)

// Si se cambia quién factura, el CP de público en general cambia con él.
watch(cpDelEmisor, (cp) => {
  if (cp && esGlobal.value) formulario.value = { ...formulario.value, cpFiscal: cp }
})

// Bimestral usa los bimestres (13-18) y las demás un mes: si el elegido ya no
// cabe, se pasa al primero que sí.
watch(mesesDelPeriodo, (validos) => {
  if (validos.length && !validos.some((m) => m.clave === periodo.value.meses)) {
    periodo.value.meses = validos[0].clave
  }
})

/**
 * El CFDI armado por la API con lo capturado, antes de timbrar. Mientras hay
 * vista se enseña ella en lugar del formulario; «Corregir datos» la quita.
 */
const vista = ref<VistaFactura | null>(null)

function cuerpo() {
  return {
    ...cuerpoFiscal(formulario.value),
    // Son los mismos datos del Perfil vistos desde otro lado: lo que se
    // corrige aquí queda guardado allá. La API solo los guarda si el SAT
    // aceptó el timbre, así que un dato rechazado no pisa al bueno.
    guardarDatos: true,
    formaPago: formaPago.value,
    ...(esGlobal.value && { ...periodo.value }),
    // El cliente no lo manda: su ruta no lo acepta.
    ...(props.porFinanzas && emisorRfc.value && { emisorRfc: emisorRfc.value }),
  }
}

function limpiarErrores(): void {
  errores.value = {}
  errorFormaPago.value = ''
  errorPeriodo.value = ''
  erroresGenerales.value = []
}

async function revisar(): Promise<void> {
  if (enviando.value) return
  enviando.value = true
  limpiarErrores()
  try {
    vista.value = await http.post<VistaFactura>(`${rutaFactura.value}/vista-previa`, cuerpo())
  } catch (fallo) {
    mostrarFallo(fallo)
  } finally {
    enviando.value = false
  }
}

async function timbrar(): Promise<void> {
  if (enviando.value) return
  enviando.value = true
  limpiarErrores()
  try {
    const factura = await http.post<FacturaDePedido>(rutaFactura.value, cuerpo())
    ui.exito(`Factura del pedido ${props.pedido.folio} timbrada`)
    emit('facturado', factura)
  } catch (fallo) {
    // Lo que haya que corregir se ve en el formulario, no en la vista.
    vista.value = null
    mostrarFallo(fallo)
  } finally {
    enviando.value = false
  }
}

function mostrarFallo(fallo: unknown): void {
  if (!(fallo instanceof ErrorApi)) {
    ui.errorDeApi(fallo)
  } else if (fallo.codigo === 'YA_FACTURADO' || fallo.codigo === 'TIMBRADO_EN_CURSO') {
    // Otra pestaña se adelantó: lo que hay que enseñar es la lista al día.
    ui.info(fallo.message)
    emit('facturado', null)
  } else if (fallo.codigo === 'INFORMACION_GLOBAL_INVALIDA') {
    errorPeriodo.value = fallo.message
  } else if (fallo.mensajes.length > 0) {
    const { campos, generales } = fallo.porCampo([
      ...CAMPOS_FISCALES,
      'formaPago',
      'periodicidad',
      'meses',
      'anio',
    ])
    const {
      formaPago: mensajeForma,
      periodicidad,
      meses,
      anio,
      ...fiscales
    } = erroresSinNombreDeCampo<CampoFiscal | 'formaPago' | 'periodicidad' | 'meses' | 'anio'>(
      campos,
    )
    errores.value = fiscales
    errorFormaPago.value = mensajeForma ?? ''
    errorPeriodo.value = periodicidad ?? meses ?? anio ?? ''
    erroresGenerales.value = generales
  } else {
    // El rechazo del SAT (422) y los candados (409) se quedan en la hoja:
    // casi siempre se arreglan corrigiendo un dato.
    erroresGenerales.value = [fallo.message]
  }
}
</script>

<template>
  <div class="modal-overlay">
    <div class="modal-sheet" role="dialog" aria-modal="true" aria-label="Facturar pedido">
      <div class="modal-handle" />
      <p class="modal-title">🧾 Facturar {{ pedido.folio }} · {{ dinero(pedido.total) }}</p>

      <p v-if="cargando" class="modal-texto">Cargando…</p>

      <!-- La factura tal como se va a timbrar: se confirma desde aquí. -->
      <VistaPreviaFactura
        v-else-if="vista"
        :vista="vista"
        :catalogos="catalogos"
        :receptor-en-tercera="porFinanzas"
      >
        <button type="button" class="btn-cancel" :disabled="enviando" @click="vista = null">
          ← Corregir datos
        </button>
        <button type="button" class="btn-primary" :disabled="enviando" @click="timbrar">
          {{ enviando ? 'Timbrando…' : 'Timbrar factura' }}
        </button>
      </VistaPreviaFactura>

      <form v-else novalidate @submit.prevent="revisar">
        <p v-if="simulado" class="aviso-demo">
          Modo demostración: la factura se genera con un folio de prueba y no tiene validez fiscal.
        </p>
        <p class="modal-texto">
          <template v-if="porFinanzas">
            Los datos de {{ pedido.clienteNombre ?? 'el cliente' }} tal cual aparecen en su
            Constancia de Situación Fiscal. Si ya los tenía guardados, vienen llenos.
          </template>
          <template v-else>
            Escribe tus datos tal cual aparecen en tu Constancia de Situación Fiscal.
          </template>
        </p>

        <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error">{{ mensaje }}</p>

        <!-- Solo Finanzas, y con una sola cuenta de factura.com no hay nada que elegir. -->
        <template v-if="porFinanzas && emisores.length > 1">
          <label class="form-label" for="fa-emisor">Factura a nombre de</label>
          <select id="fa-emisor" v-model="emisorRfc" class="select-input">
            <option v-for="e in emisores" :key="e.rfc" :value="e.rfc">
              {{ e.nombre }} · {{ e.rfc }}
            </option>
          </select>
          <p class="form-hint">
            Ya viene con el de la tienda del pedido; a domicilio, con el principal.
          </p>
        </template>

        <CamposFiscales
          v-model="formulario"
          :catalogos="catalogos"
          :errores="errores"
          prefijo="fa"
        />

        <!-- PÚBLICO EN GENERAL: el SAT pide qué periodo de ventas cubre. -->
        <div v-if="esGlobal" class="zona-captura periodo">
          <p class="periodo-titulo">Información global</p>
          <p class="form-hint">
            A público en general el SAT la trata como factura global: di qué periodo de ventas
            cubre. Ya viene con el mes de este pedido. El código postal será el de quien factura.
          </p>

          <label class="form-label" for="fa-periodicidad">Periodicidad</label>
          <select id="fa-periodicidad" v-model="periodo.periodicidad" class="select-input">
            <option v-for="p in catalogos?.periodicidades ?? []" :key="p.clave" :value="p.clave">
              {{ p.clave }} · {{ p.nombre }}
            </option>
          </select>

          <div class="periodo-fila">
            <div>
              <label class="form-label" for="fa-meses">Mes</label>
              <select id="fa-meses" v-model="periodo.meses" class="select-input">
                <option v-for="m in mesesDelPeriodo" :key="m.clave" :value="m.clave">
                  {{ m.nombre }}
                </option>
              </select>
            </div>
            <div>
              <label class="form-label" for="fa-anio">Año</label>
              <select id="fa-anio" v-model.number="periodo.anio" class="select-input">
                <option v-for="a in anios" :key="a" :value="a">{{ a }}</option>
              </select>
            </div>
          </div>
          <p v-if="errorPeriodo" class="form-error">{{ errorPeriodo }}</p>
        </div>
        <p v-else-if="genericoNominativo" class="form-hint">
          RFC genérico con el nombre de la persona: la factura sale a su nombre y no lleva periodo.
          Para factura global escribe {{ PUBLICO_EN_GENERAL }}.
        </p>

        <label class="form-label" for="fa-forma-pago">Forma de pago</label>
        <select
          id="fa-forma-pago"
          v-model="formaPago"
          class="select-input"
          :class="{ 'is-invalid': errorFormaPago }"
        >
          <option v-for="f in catalogos?.formasPago ?? []" :key="f.clave" :value="f.clave">
            {{ f.clave }} · {{ f.descripcion }}
          </option>
        </select>
        <p v-if="errorFormaPago" class="form-error">{{ errorFormaPago }}</p>
        <p class="form-hint">
          Ya viene con la forma en que {{ porFinanzas ? 'se pagó' : 'pagaste' }} este pedido.
        </p>

        <p class="nota-guardado">
          Estos datos también quedan guardados en
          {{ porFinanzas ? 'el perfil del cliente' : 'tu perfil' }}.
        </p>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" @click="emit('cerrar')">Cancelar</button>
          <button type="submit" class="btn-primary" :disabled="enviando">
            {{ enviando ? 'Preparando…' : 'Revisar factura' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.modal-texto {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.45;
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

.select-input {
  /* 16 px como los demás campos: por debajo, Safari en iPhone hace zoom. */
  font-size: 16px;
}

.form-hint {
  margin: -6px 0 10px;
  font-size: 11px;
  color: var(--muted);
}

.periodo {
  margin: 4px 0 12px;
}

.periodo .select-input {
  background: #fff;
}

.periodo-titulo {
  margin: 0 0 4px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13px;
  color: var(--ink);
}

.periodo .form-hint {
  margin: 0 0 8px;
}

.periodo-fila {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.nota-guardado {
  margin: 4px 0 14px;
  font-size: 11px;
  color: var(--muted);
}
</style>
