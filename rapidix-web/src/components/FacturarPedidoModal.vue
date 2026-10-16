<script setup lang="ts">
/**
 * «Facturar» de Mis pedidos: los datos fiscales del cliente y el timbrado.
 *
 * Los catálogos (régimen y uso del CFDI) y lo guardado —aquí o en el Perfil—
 * llegan juntos de `GET /perfil/datos-fiscales`: la interfaz no lleva copia de
 * los catálogos del SAT. Los candados (entregado, pagado, una factura por
 * pedido) los pone la API; aquí solo se captura y se enseña lo que responda.
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
import type { DatosFiscalesRespuesta, FacturaDePedido, Pedido } from '@/api/tipos'

const props = defineProps<{ pedido: Pedido }>()
const emit = defineEmits<{
  (e: 'cerrar'): void
  /** Ya tiene CFDI (o alguien lo timbró mientras tanto): quien abrió relee la lista. */
  (e: 'facturado', factura: FacturaDePedido | null): void
}>()

const ui = useUiStore()
const catalogos = ref<DatosFiscalesRespuesta | null>(null)
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
const guardarDatos = ref(true)
/**
 * Llega con la forma en que se pagó el pedido. Se puede cambiar por otra del
 * catálogo del SAT (pagó con tarjeta en la terminal, por ejemplo) y no se
 * guarda con los datos fiscales: es de este pedido.
 */
const formaPago = ref(props.pedido.formaPagoFactura)

onMounted(async () => {
  try {
    catalogos.value = await http.get<DatosFiscalesRespuesta>('/perfil/datos-fiscales')
    formulario.value = formularioFiscalDesde(catalogos.value)
    // Ya los tenía guardados: la casilla nace apagada, porque no hay nada
    // nuevo que guardar salvo que los cambie.
    guardarDatos.value = catalogos.value.datos === null
  } catch (fallo) {
    ui.errorDeApi(fallo)
    emit('cerrar')
  } finally {
    cargando.value = false
  }
})

const simulado = computed(() => catalogos.value?.modo === 'SIMULADO')

async function timbrar(): Promise<void> {
  if (enviando.value) return
  enviando.value = true
  errores.value = {}
  errorFormaPago.value = ''
  erroresGenerales.value = []
  try {
    const factura = await http.post<FacturaDePedido>(`/pedidos/${props.pedido.id}/factura`, {
      ...cuerpoFiscal(formulario.value),
      guardarDatos: guardarDatos.value,
      formaPago: formaPago.value,
    })
    ui.exito(`Factura del pedido ${props.pedido.folio} timbrada`)
    emit('facturado', factura)
  } catch (fallo) {
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
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <div class="modal-overlay">
    <div class="modal-sheet" role="dialog" aria-modal="true" aria-label="Facturar pedido">
      <div class="modal-handle" />
      <p class="modal-title">🧾 Facturar {{ pedido.folio }} · {{ dinero(pedido.total) }}</p>

      <p v-if="cargando" class="modal-texto">Cargando…</p>

      <form v-else novalidate @submit.prevent="timbrar">
        <p v-if="simulado" class="aviso-demo">
          Modo demostración: la factura se genera con un folio de prueba y no tiene validez fiscal.
        </p>
        <p class="modal-texto">
          Escribe tus datos tal cual aparecen en tu Constancia de Situación Fiscal.
        </p>

        <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error">{{ mensaje }}</p>

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
        <p class="form-hint">Ya viene con la forma en que pagaste este pedido.</p>

        <label class="guardar">
          <input v-model="guardarDatos" type="checkbox" />
          Guardar estos datos para mis próximas facturas
        </label>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" @click="emit('cerrar')">Cancelar</button>
          <button type="submit" class="btn-primary" :disabled="enviando">
            {{ enviando ? 'Timbrando…' : 'Timbrar factura' }}
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

.guardar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 14px;
  font-size: 12.5px;
  color: var(--ink);
}
</style>
