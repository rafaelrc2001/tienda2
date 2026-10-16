<script setup lang="ts">
/**
 * Los campos del receptor del CFDI: RFC, razón social, régimen, uso, CP y
 * correo. Los comparten «Facturar» de Mis pedidos y la tarjeta de datos de
 * facturación del Perfil, para que los dos capturen exactamente lo mismo.
 *
 * Los catálogos llegan de `GET /perfil/datos-fiscales`; aquí no hay copia.
 */
import { computed } from 'vue'
import type { DatosFiscalesRespuesta } from '@/api/tipos'
import type { CampoFiscal, FormularioFiscal } from '@/utils/datosFiscales'

const props = defineProps<{
  catalogos: DatosFiscalesRespuesta | null
  errores: Partial<Record<CampoFiscal, string>>
  /** Prefijo de los `id`: el modal y el perfil pueden estar montados a la vez. */
  prefijo: string
}>()
const formulario = defineModel<FormularioFiscal>({ required: true })

/**
 * El RFC dice el tipo de persona (12 caracteres moral, 13 física) y con él qué
 * regímenes aplican. Mientras no está completo se ofrecen todos.
 */
const regimenes = computed(() => {
  const todos = props.catalogos?.regimenes ?? []
  const largo = formulario.value.rfc.trim().length
  if (largo !== 12 && largo !== 13) return todos
  const persona = largo === 12 ? 'MORAL' : 'FISICA'
  return todos.filter((r) => r.personas.includes(persona))
})
</script>

<template>
  <label class="form-label" :for="`${prefijo}-rfc`">RFC</label>
  <input
    :id="`${prefijo}-rfc`"
    v-model="formulario.rfc"
    class="form-input mayusculas"
    :class="{ 'is-invalid': errores.rfc }"
    maxlength="13"
    autocomplete="off"
    autocapitalize="characters"
    spellcheck="false"
  />
  <p v-if="errores.rfc" class="form-error">{{ errores.rfc }}</p>

  <label class="form-label" :for="`${prefijo}-razon`">Nombre o razón social</label>
  <input
    :id="`${prefijo}-razon`"
    v-model="formulario.razonSocial"
    class="form-input mayusculas"
    :class="{ 'is-invalid': errores.razonSocial }"
    maxlength="254"
    autocapitalize="characters"
  />
  <p v-if="errores.razonSocial" class="form-error">{{ errores.razonSocial }}</p>
  <p class="form-hint">Si es empresa, sin «S.A. de C.V.» ni otro régimen societario.</p>

  <label class="form-label" :for="`${prefijo}-regimen`">Régimen fiscal</label>
  <select
    :id="`${prefijo}-regimen`"
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

  <label class="form-label" :for="`${prefijo}-uso`">Uso del CFDI</label>
  <select
    :id="`${prefijo}-uso`"
    v-model="formulario.usoCfdi"
    class="select-input"
    :class="{ 'is-invalid': errores.usoCfdi }"
  >
    <option v-for="u in catalogos?.usos ?? []" :key="u.clave" :value="u.clave">
      {{ u.clave }} · {{ u.nombre }}
    </option>
  </select>
  <p v-if="errores.usoCfdi" class="form-error">{{ errores.usoCfdi }}</p>

  <label class="form-label" :for="`${prefijo}-cp`">Código postal fiscal</label>
  <input
    :id="`${prefijo}-cp`"
    v-model="formulario.cpFiscal"
    class="form-input"
    :class="{ 'is-invalid': errores.cpFiscal }"
    inputmode="numeric"
    maxlength="5"
  />
  <p v-if="errores.cpFiscal" class="form-error">{{ errores.cpFiscal }}</p>

  <label class="form-label" :for="`${prefijo}-email`">Correo donde te llega la factura</label>
  <input
    :id="`${prefijo}-email`"
    v-model="formulario.email"
    class="form-input"
    :class="{ 'is-invalid': errores.email }"
    type="email"
    autocomplete="email"
  />
  <p v-if="errores.email" class="form-error">{{ errores.email }}</p>
</template>

<style scoped>
/* Los inputs van a 16 px: por debajo, Safari en iPhone hace zoom al
   enfocarlos y la pantalla se descuadra. */
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
</style>
