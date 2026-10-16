<script setup lang="ts">
/**
 * «Facturar» de Mis pedidos: los datos fiscales del cliente y el timbrado.
 *
 * Los catálogos (régimen y uso del CFDI) y lo guardado la última vez llegan
 * juntos de `GET /perfil/datos-fiscales`: la interfaz no lleva copia de los
 * catálogos del SAT. Los candados (entregado, pagado, una factura por pedido)
 * los pone la API; aquí solo se captura y se enseña lo que responda.
 */
import { computed, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero } from '@/utils/formato'
import type { DatosFiscalesRespuesta, FacturaDePedido, Pedido } from '@/api/tipos'

const props = defineProps<{ pedido: Pedido }>()
const emit = defineEmits<{
  (e: 'cerrar'): void
  /** Ya tiene CFDI (o alguien lo timbró mientras tanto): quien abrió relee la lista. */
  (e: 'facturado', factura: FacturaDePedido | null): void
}>()

const CAMPOS = ['rfc', 'razonSocial', 'regimenFiscal', 'usoCfdi', 'cpFiscal', 'email'] as const
type Campo = (typeof CAMPOS)[number]

const ui = useUiStore()
const catalogos = ref<DatosFiscalesRespuesta | null>(null)
const cargando = ref(true)
const enviando = ref(false)
const errores = ref<Partial<Record<Campo, string>>>({})
const erroresGenerales = ref<string[]>([])

const formulario = ref({
  rfc: '',
  razonSocial: '',
  regimenFiscal: '',
  usoCfdi: 'G03',
  cpFiscal: '',
  email: '',
  guardarDatos: true,
})

onMounted(async () => {
  try {
    catalogos.value = await http.get<DatosFiscalesRespuesta>('/perfil/datos-fiscales')
    const datos = catalogos.value.datos
    if (datos) {
      // Ya los tenía guardados: se precargan y la casilla nace apagada, porque
      // no hay nada nuevo que guardar salvo que los cambie.
      formulario.value = { ...datos, email: datos.email ?? '', guardarDatos: false }
    } else {
      formulario.value.email = catalogos.value.emailSugerido ?? ''
    }
  } catch (fallo) {
    ui.errorDeApi(fallo)
    emit('cerrar')
  } finally {
    cargando.value = false
  }
})

/**
 * El RFC dice el tipo de persona (12 caracteres moral, 13 física) y con él qué
 * regímenes aplican. Mientras no está completo se ofrecen todos.
 */
const regimenes = computed(() => {
  const todos = catalogos.value?.regimenes ?? []
  const largo = formulario.value.rfc.trim().length
  if (largo !== 12 && largo !== 13) return todos
  const persona = largo === 12 ? 'MORAL' : 'FISICA'
  return todos.filter((r) => r.personas.includes(persona))
})

const simulado = computed(() => catalogos.value?.modo === 'SIMULADO')

/** «rfc no es válido…» llega con el nombre del campo delante; bajo el campo sobra. */
function sinNombreDeCampo(campo: string, mensaje: string): string {
  const resto = mensaje.slice(campo.length + 1)
  return resto.charAt(0).toUpperCase() + resto.slice(1)
}

async function timbrar(): Promise<void> {
  if (enviando.value) return
  enviando.value = true
  errores.value = {}
  erroresGenerales.value = []
  const f = formulario.value
  try {
    const factura = await http.post<FacturaDePedido>(`/pedidos/${props.pedido.id}/factura`, {
      rfc: f.rfc.trim().toUpperCase(),
      razonSocial: f.razonSocial.trim(),
      regimenFiscal: f.regimenFiscal,
      usoCfdi: f.usoCfdi,
      cpFiscal: f.cpFiscal.trim(),
      email: f.email.trim(),
      guardarDatos: f.guardarDatos,
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
      const { campos, generales } = fallo.porCampo(CAMPOS)
      errores.value = Object.fromEntries(
        Object.entries(campos).map(([c, m]) => [c, sinNombreDeCampo(c, m)]),
      )
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
  <div class="modal-overlay" @click.self="emit('cerrar')">
    <div class="modal-sheet" role="dialog" aria-label="Facturar pedido">
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

        <label class="form-label" for="fa-rfc">RFC</label>
        <input
          id="fa-rfc"
          v-model="formulario.rfc"
          class="form-input mayusculas"
          :class="{ 'is-invalid': errores.rfc }"
          maxlength="13"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
        />
        <p v-if="errores.rfc" class="form-error">{{ errores.rfc }}</p>

        <label class="form-label" for="fa-razon">Nombre o razón social</label>
        <input
          id="fa-razon"
          v-model="formulario.razonSocial"
          class="form-input mayusculas"
          :class="{ 'is-invalid': errores.razonSocial }"
          maxlength="254"
          autocapitalize="characters"
        />
        <p v-if="errores.razonSocial" class="form-error">{{ errores.razonSocial }}</p>
        <p class="form-hint">Si es empresa, sin «S.A. de C.V.» ni otro régimen societario.</p>

        <label class="form-label" for="fa-regimen">Régimen fiscal</label>
        <select
          id="fa-regimen"
          v-model="formulario.regimenFiscal"
          class="select-input"
          :class="{ 'is-invalid': errores.regimenFiscal }"
        >
          <option value="" disabled>Elige tu régimen</option>
          <option v-for="r in regimenes" :key="r.clave" :value="r.clave">
            {{ r.clave }} · {{ r.nombre }}
          </option>
        </select>
        <p v-if="errores.regimenFiscal" class="form-error">{{ errores.regimenFiscal }}</p>

        <label class="form-label" for="fa-uso">Uso del CFDI</label>
        <select
          id="fa-uso"
          v-model="formulario.usoCfdi"
          class="select-input"
          :class="{ 'is-invalid': errores.usoCfdi }"
        >
          <option v-for="u in catalogos?.usos ?? []" :key="u.clave" :value="u.clave">
            {{ u.clave }} · {{ u.nombre }}
          </option>
        </select>
        <p v-if="errores.usoCfdi" class="form-error">{{ errores.usoCfdi }}</p>

        <label class="form-label" for="fa-cp">Código postal fiscal</label>
        <input
          id="fa-cp"
          v-model="formulario.cpFiscal"
          class="form-input"
          :class="{ 'is-invalid': errores.cpFiscal }"
          inputmode="numeric"
          maxlength="5"
        />
        <p v-if="errores.cpFiscal" class="form-error">{{ errores.cpFiscal }}</p>

        <label class="form-label" for="fa-email">Correo donde te llega la factura</label>
        <input
          id="fa-email"
          v-model="formulario.email"
          class="form-input"
          :class="{ 'is-invalid': errores.email }"
          type="email"
          autocomplete="email"
        />
        <p v-if="errores.email" class="form-error">{{ errores.email }}</p>

        <label class="guardar">
          <input v-model="formulario.guardarDatos" type="checkbox" />
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

/* Los inputs del formulario van a 16 px: por debajo, Safari en iPhone hace
   zoom al enfocarlos y la hoja se descuadra. */
.form-input,
.select-input {
  font-size: 16px;
}

.form-hint {
  margin: -6px 0 10px;
  font-size: 11px;
  color: var(--muted);
}

.mayusculas {
  text-transform: uppercase;
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
