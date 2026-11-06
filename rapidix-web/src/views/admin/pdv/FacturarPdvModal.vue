<script setup lang="ts">
/**
 * «Facturar» del punto de venta: uno o varios pedidos de la tienda en una sola
 * factura, con la razón social que se elija.
 *
 * Enseña de quién son los pedidos. Si todos son de un cliente que ya tiene sus
 * datos fiscales, llegan llenos; si no, se capturan aquí mismo —no tienen que
 * estar en ninguna ficha— y con el WhatsApp se guardan para la próxima: el
 * cliente que lo tiene los recibe, y si nadie lo tiene la API lo da de alta.
 *
 * Igual que en Mis pedidos, «Revisar factura» pide a la API el CFDI armado y
 * se timbra desde la vista. Los candados (pagado, un CFDI por pedido, de esta
 * tienda) los pone la API; aquí solo se captura y se enseña lo que responda.
 *
 * Tocar fuera de la hoja no la cierra: con el formulario a medias se perdía
 * lo capturado por un toque de más.
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
import type { DatosFacturaPdv, FacturaPdv, Tienda, VistaFactura } from '@/api/tipos'

const props = defineProps<{ tienda: Tienda; pedidoIds: string[] }>()
const emit = defineEmits<{
  (e: 'cerrar'): void
  /** Ya tiene CFDI (o alguien lo timbró mientras tanto): quien abrió relee la lista. */
  (e: 'facturado', factura: FacturaPdv | null): void
}>()

const CAMPOS_EXTRA = ['formaPago', 'whatsapp', 'razonSocialId'] as const
type CampoExtra = (typeof CAMPOS_EXTRA)[number]

const ui = useUiStore()
const base = computed(() => `/admin/pdv/tiendas/${props.tienda.id}/facturacion`)

const datos = ref<DatosFacturaPdv | null>(null)
const cargando = ref(true)
const enviando = ref(false)
const errores = ref<Partial<Record<CampoFiscal | CampoExtra, string>>>({})
const erroresGenerales = ref<string[]>([])

const formulario = ref<FormularioFiscal>({
  rfc: '',
  razonSocial: '',
  regimenFiscal: '',
  usoCfdi: 'G03',
  cpFiscal: '',
  email: '',
})
const razonSocialId = ref('')
const formaPago = ref('')
const whatsapp = ref('')

onMounted(async () => {
  try {
    const respuesta = await http.post<DatosFacturaPdv>(`${base.value}/datos`, {
      pedidoIds: props.pedidoIds,
    })
    datos.value = respuesta
    formulario.value = formularioFiscalDesde({
      datos: respuesta.receptor,
      emailSugerido: respuesta.emailSugerido,
    })
    // La principal llega primero.
    razonSocialId.value = respuesta.razonesSociales[0]?.id ?? ''
    formaPago.value = respuesta.formaPagoSugerida
    whatsapp.value = respuesta.whatsappSugerido ?? ''
  } catch (fallo) {
    ui.errorDeApi(fallo)
    // Uno ya facturado o a medio timbrar: la lista que lo ofrecía está vieja.
    const yaNoVa =
      fallo instanceof ErrorApi &&
      (fallo.codigo === 'YA_FACTURADO' || fallo.codigo === 'TIMBRADO_EN_CURSO')
    if (yaNoVa) emit('facturado', null)
    else emit('cerrar')
  } finally {
    cargando.value = false
  }
})

const varios = computed(() => (datos.value?.pedidos.length ?? 0) > 1)

/** Los clientes distintos de los pedidos: con uno solo se habla de él. */
const clientes = computed(() => {
  const vistos = new Map<string, { nombre: string; telefono: string }>()
  for (const p of datos.value?.pedidos ?? []) vistos.set(p.cliente.id, p.cliente)
  return [...vistos.values()]
})

const emisor = computed(
  () => datos.value?.razonesSociales.find((r) => r.id === razonSocialId.value) ?? null,
)

/**
 * El CFDI armado por la API con lo capturado, antes de timbrar. Mientras hay
 * vista se enseña ella en lugar del formulario; «Corregir datos» la quita.
 */
const vista = ref<VistaFactura | null>(null)

function cuerpo() {
  return {
    ...cuerpoFiscal(formulario.value),
    pedidoIds: props.pedidoIds,
    razonSocialId: razonSocialId.value,
    formaPago: formaPago.value,
    whatsapp: whatsapp.value.trim(),
  }
}

function limpiarErrores(): void {
  errores.value = {}
  erroresGenerales.value = []
}

async function revisar(): Promise<void> {
  if (enviando.value) return
  enviando.value = true
  limpiarErrores()
  try {
    vista.value = await http.post<VistaFactura>(`${base.value}/vista-previa`, cuerpo())
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
    const factura = await http.post<FacturaPdv>(base.value, cuerpo())
    ui.exito(
      varios.value
        ? `Factura de ${props.pedidoIds.length} pedidos timbrada`
        : `Factura de ${datos.value?.pedidos[0]?.folio ?? 'el pedido'} timbrada`,
    )
    const guardados = factura.datosGuardadosEn
    if (guardados?.nuevo) {
      ui.info(`${guardados.nombre} quedó dado de alta con el WhatsApp ${guardados.telefono}.`)
    } else if (guardados) {
      ui.info(`Los datos fiscales quedaron guardados en la ficha de ${guardados.nombre}.`)
    }
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
    // Otra caja se adelantó: lo que hay que enseñar es la lista al día.
    ui.info(fallo.message)
    emit('facturado', null)
  } else if (fallo.mensajes.length > 0) {
    const { campos, generales } = fallo.porCampo([...CAMPOS_FISCALES, ...CAMPOS_EXTRA])
    errores.value = erroresSinNombreDeCampo<CampoFiscal | CampoExtra>(campos)
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
    <div class="modal-sheet hoja-ancha" role="dialog" aria-modal="true" aria-label="Facturar">
      <div class="modal-handle" />
      <p class="modal-title">
        🧾 Facturar
        <template v-if="datos">
          {{ varios ? `${datos.pedidos.length} pedidos` : datos.pedidos[0]?.folio }} ·
          {{ dinero(datos.aFacturar) }}
        </template>
      </p>

      <p v-if="cargando" class="modal-texto">Cargando…</p>

      <!-- La factura tal como se va a timbrar: se confirma desde aquí. -->
      <VistaPreviaFactura
        v-else-if="vista && datos"
        :vista="vista"
        :catalogos="datos"
        receptor-en-tercera
      >
        <button type="button" class="btn-cancel" :disabled="enviando" @click="vista = null">
          ← Corregir datos
        </button>
        <button type="button" class="btn-primary" :disabled="enviando" @click="timbrar">
          {{ enviando ? 'Timbrando…' : 'Timbrar factura' }}
        </button>
      </VistaPreviaFactura>

      <form v-else-if="datos" novalidate @submit.prevent="revisar">
        <!-- De quién son: es lo primero que hay que confirmar con quien pide la factura. -->
        <div class="tabla-envoltorio">
          <table class="tabla lineal pedidos">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>WhatsApp</th>
                <th class="num">A facturar</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in datos.pedidos" :key="p.id">
                <td><span class="folio">{{ p.folio }}</span></td>
                <td>{{ p.cliente.nombre }}</td>
                <td class="telefono">{{ p.cliente.telefono }}</td>
                <td class="num">{{ dinero(p.aFacturar) }}</td>
              </tr>
            </tbody>
            <tfoot v-if="varios">
              <tr>
                <td colspan="3">Total de la factura</td>
                <td class="num">{{ dinero(datos.aFacturar) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error">{{ mensaje }}</p>

        <section class="zona-captura grupo" aria-label="Quién emite">
          <label class="form-label" for="fp-emisor">Razón social que factura</label>
          <select
            id="fp-emisor"
            v-model="razonSocialId"
            class="select-input"
            :class="{ 'is-invalid': errores.razonSocialId }"
            :disabled="datos.razonesSociales.length === 0"
          >
            <option v-for="r in datos.razonesSociales" :key="r.id" :value="r.id">
              {{ r.nombre }} · {{ r.rfc }}{{ r.principal ? ' (principal)' : '' }}
            </option>
          </select>
          <p v-if="errores.razonSocialId" class="form-error">{{ errores.razonSocialId }}</p>
          <p v-if="datos.razonesSociales.length === 0" class="form-error">
            No hay razones sociales activas: dalas de alta en Configuración → Fiscal.
          </p>
          <p v-else-if="emisor?.modo === 'SIMULADO'" class="aviso-demo">
            Esta razón social no tiene llaves de factura.com: la factura sale en modo demostración,
            con un folio de prueba y sin validez fiscal.
          </p>
        </section>

        <section class="zona-captura grupo" aria-label="Datos del receptor">
          <p class="modal-texto">
            <template v-if="datos.receptor">
              Los datos fiscales guardados de {{ clientes[0]?.nombre }}. Corrígelos si cambiaron.
            </template>
            <template v-else-if="clientes.length === 1">
              {{ clientes[0].nombre }} no tiene datos fiscales guardados: escríbelos tal cual su
              Constancia de Situación Fiscal.
            </template>
            <template v-else>
              Los pedidos son de clientes distintos: escribe los datos de quien recibe la factura,
              tal cual su Constancia de Situación Fiscal.
            </template>
          </p>

          <CamposFiscales v-model="formulario" :catalogos="datos" :errores="errores" prefijo="fp" />

          <label class="form-label" for="fp-forma-pago">Forma de pago</label>
          <select
            id="fp-forma-pago"
            v-model="formaPago"
            class="select-input"
            :class="{ 'is-invalid': errores.formaPago }"
          >
            <option v-for="f in datos.formasPago" :key="f.clave" :value="f.clave">
              {{ f.clave }} · {{ f.descripcion }}
            </option>
          </select>
          <p v-if="errores.formaPago" class="form-error">{{ errores.formaPago }}</p>
          <p class="form-hint">
            Ya viene con la forma en que se pagó{{ varios ? ' el pedido de mayor importe' : '' }}.
          </p>
        </section>

        <section class="zona-captura grupo" aria-label="Guardar los datos">
          <label class="form-label" for="fp-whatsapp">WhatsApp para guardar estos datos</label>
          <input
            id="fp-whatsapp"
            v-model="whatsapp"
            class="form-input"
            :class="{ 'is-invalid': errores.whatsapp }"
            type="tel"
            inputmode="tel"
            maxlength="20"
            autocomplete="off"
            placeholder="10 dígitos"
          />
          <p v-if="errores.whatsapp" class="form-error">{{ errores.whatsapp }}</p>
          <p class="form-hint">
            Los datos fiscales quedan en la ficha de quien tenga este WhatsApp; si nadie lo tiene,
            se da de alta como cliente para sus próximas compras. Déjalo vacío para no guardarlos.
          </p>
        </section>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" @click="emit('cerrar')">Cancelar</button>
          <button
            type="submit"
            class="btn-primary"
            :disabled="enviando || datos.razonesSociales.length === 0"
          >
            {{ enviando ? 'Preparando…' : 'Revisar factura' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
/* En el punto de venta la pantalla es ancha: la hoja aprovecha un poco más. */
.hoja-ancha {
  max-width: 560px;
}

.modal-texto {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.45;
}

.grupo {
  margin-bottom: 12px;
}

.aviso-demo {
  margin: 0;
  padding: 9px 12px;
  border-radius: 11px;
  background: var(--cream-2);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11.5px;
  color: var(--terracotta-dark);
}

.form-input,
.select-input {
  /* 16 px como los demás campos: por debajo, Safari en iPhone hace zoom. */
  font-size: 16px;
}

.form-hint {
  margin: -6px 0 0;
  font-size: 11px;
  color: var(--muted);
}

.pedidos {
  margin-bottom: 12px;
}

.pedidos .folio,
.pedidos .telefono {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.pedidos tfoot td {
  font-family: var(--font-heading);
  font-weight: 800;
}
</style>
