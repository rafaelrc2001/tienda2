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
import { computed, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero } from '@/utils/formato'
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
    // El cliente no lo manda: su ruta no lo acepta.
    ...(props.porFinanzas && emisorRfc.value && { emisorRfc: emisorRfc.value }),
  }
}

function limpiarErrores(): void {
  errores.value = {}
  errorFormaPago.value = ''
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
  } else if (fallo.mensajes.length > 0) {
    const { campos, generales } = fallo.porCampo([...CAMPOS_FISCALES, 'formaPago'])
    const { formaPago: mensajeForma, ...fiscales } = erroresSinNombreDeCampo<
      CampoFiscal | 'formaPago'
    >(campos)
    errores.value = fiscales
    errorFormaPago.value = mensajeForma ?? ''
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

.nota-guardado {
  margin: 4px 0 14px;
  font-size: 11px;
  color: var(--muted);
}
</style>
