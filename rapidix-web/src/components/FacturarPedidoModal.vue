<script setup lang="ts">
/**
 * «Facturar» de Mis pedidos: los datos fiscales del cliente y el timbrado.
 *
 * Finanzas usa la misma hoja (`porFinanzas`) para facturar a nombre del
 * cliente: cambian las rutas —las del panel, que sacan al cliente del
 * pedido— y los textos, que le hablan al personal y no al cliente.
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
import type { DatosFiscalesRespuesta, FacturaDePedido, Pedido, VistaFactura } from '@/api/tipos'

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
/**
 * Llega con la forma en que se pagó el pedido. Se puede cambiar por otra del
 * catálogo del SAT (pagó con tarjeta en la terminal, por ejemplo) y no se
 * guarda con los datos fiscales: es de este pedido.
 */
const formaPago = ref(props.pedido.formaPagoFactura)

onMounted(async () => {
  try {
    catalogos.value = await http.get<DatosFiscalesRespuesta>(rutaDatos.value)
    formulario.value = formularioFiscalDesde(catalogos.value)
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

/** Las claves del SAT con su nombre, de los catálogos que ya trajo la hoja. */
function nombreRegimen(clave: string | null): string {
  if (!clave) return 'Sin capturar'
  const r = catalogos.value?.regimenes.find((x) => x.clave === clave)
  return r ? `${clave} · ${r.nombre}` : clave
}

function nombreUso(clave: string): string {
  const u = catalogos.value?.usos.find((x) => x.clave === clave)
  return u ? `${clave} · ${u.nombre}` : clave
}

function nombreForma(clave: string): string {
  const f = catalogos.value?.formasPago.find((x) => x.clave === clave)
  return f ? `${clave} · ${f.descripcion}` : clave
}

const conRetencion = computed(() => (vista.value?.retencionIsr ?? 0) > 0)

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
      <section v-else-if="vista" aria-label="Vista previa de la factura">
        <p v-if="simulado" class="aviso-demo">
          Modo demostración: la factura se genera con un folio de prueba y no tiene validez fiscal.
        </p>
        <p class="modal-texto">Revisa la factura antes de timbrarla: así se manda al SAT.</p>

        <div class="partes">
          <div class="parte">
            <p class="seccion">Emisor</p>
            <dl>
              <div>
                <dt>RFC</dt>
                <dd>{{ vista.emisor.rfc ?? 'Sin capturar' }}</dd>
              </div>
              <div>
                <dt>Nombre</dt>
                <dd>{{ vista.emisor.nombre ?? 'Sin capturar' }}</dd>
              </div>
              <div>
                <dt>Régimen</dt>
                <dd>{{ nombreRegimen(vista.emisor.regimen) }}</dd>
              </div>
            </dl>
          </div>
          <div class="parte">
            <p class="seccion">Receptor</p>
            <dl>
              <div>
                <dt>RFC</dt>
                <dd>{{ vista.receptor.rfc }}</dd>
              </div>
              <div>
                <dt>Razón social</dt>
                <dd>{{ vista.receptor.razonSocial }}</dd>
              </div>
              <div>
                <dt>Régimen</dt>
                <dd>{{ nombreRegimen(vista.receptor.regimenFiscal) }}</dd>
              </div>
              <div>
                <dt>Uso del CFDI</dt>
                <dd>{{ nombreUso(vista.receptor.usoCfdi) }}</dd>
              </div>
              <div>
                <dt>Código postal</dt>
                <dd>{{ vista.receptor.cpFiscal }}</dd>
              </div>
            </dl>
          </div>
          <div class="parte">
            <p class="seccion">Pago</p>
            <dl>
              <div>
                <dt>Forma de pago</dt>
                <dd>{{ nombreForma(vista.formaPago) }}</dd>
              </div>
              <div>
                <dt>Método de pago</dt>
                <dd>PUE · Pago en una sola exhibición</dd>
              </div>
            </dl>
          </div>
        </div>

        <div class="tabla-envoltorio">
          <table class="tabla lineal conceptos">
            <thead>
              <tr>
                <th class="num">Cant.</th>
                <th>Concepto</th>
                <th class="num">P. unitario</th>
                <th class="num">Importe</th>
                <th class="num">Desc.</th>
                <th class="num">IVA</th>
                <th v-if="conRetencion" class="num">ISR ret.</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(c, i) in vista.conceptos" :key="i">
                <td class="num">{{ c.cantidad }}</td>
                <td>
                  {{ c.descripcion }}
                  <span class="claves"
                    >{{ c.claveProdServ }} · {{ c.claveUnidad }} {{ c.unidad }}</span
                  >
                </td>
                <td class="num">{{ dinero(Number(c.valorUnitario)) }}</td>
                <td class="num">{{ dinero(c.importe) }}</td>
                <td class="num">{{ c.descuento > 0 ? dinero(c.descuento) : '—' }}</td>
                <td class="num">
                  {{ c.tasaIva === 'DIECISEIS' ? '16%' : '0%' }} {{ dinero(c.iva) }}
                </td>
                <td v-if="conRetencion" class="num">{{ dinero(c.retencionIsr) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <dl class="totales">
          <div>
            <dt>Subtotal</dt>
            <dd>{{ dinero(vista.subtotal) }}</dd>
          </div>
          <div v-if="vista.descuento > 0">
            <dt>Descuento</dt>
            <dd>−{{ dinero(vista.descuento) }}</dd>
          </div>
          <div>
            <dt>IVA trasladado</dt>
            <dd>{{ dinero(vista.iva) }}</dd>
          </div>
          <div v-if="conRetencion">
            <dt>ISR retenido 1.25 %</dt>
            <dd>−{{ dinero(vista.retencionIsr) }}</dd>
          </div>
          <div class="fuerte">
            <dt>Total</dt>
            <dd>{{ dinero(vista.total) }}</dd>
          </div>
        </dl>
        <p v-if="conRetencion" class="nota-retencion">
          Lleva retención de ISR: el negocio está en RESICO (626) y
          {{ porFinanzas ? 'el cliente' : 'tú' }} {{ porFinanzas ? 'es' : 'eres' }} persona moral.
          El total es subtotal + IVA − retención.
        </p>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" :disabled="enviando" @click="vista = null">
            ← Corregir datos
          </button>
          <button type="button" class="btn-primary" :disabled="enviando" @click="timbrar">
            {{ enviando ? 'Timbrando…' : 'Timbrar factura' }}
          </button>
        </div>
      </section>

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

/* Vista previa: emisor, receptor y pago como texto, para que no parezcan campos. */
.partes {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
}

.partes dl {
  margin: 0;
}

.parte {
  padding: 10px 12px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-md);
}

.partes dl div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
}

.partes dl div + div {
  margin-top: 3px;
}

.partes dt {
  color: var(--muted);
  white-space: nowrap;
}

.partes dd {
  margin: 0;
  font-weight: 700;
  color: var(--ink);
  text-align: right;
  overflow-wrap: anywhere;
}

.seccion {
  margin: 0 0 6px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--muted);
}

.conceptos {
  min-width: 560px;
}

.claves {
  display: block;
  font-size: 10.5px;
  color: var(--muted);
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

.nota-retencion {
  margin: 10px 0 0;
  font-size: 11.5px;
  color: var(--terracotta-dark);
}
</style>
