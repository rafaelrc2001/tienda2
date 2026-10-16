<script setup lang="ts">
/**
 * Tarjeta «Datos de facturación» del Perfil.
 *
 * Son los mismos datos que pre-llenan «Facturar» en Mis pedidos (y que aquel
 * guarda si marcan la casilla): una sola copia en la API, editable desde los
 * dos lados.
 *
 * Tiene su propio botón porque va a otro endpoint (`PUT /perfil/datos-fiscales`)
 * y exige los seis campos completos: meterlo en «Guardar cambios» del perfil
 * haría fallar ese guardado a quien no factura.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import {
  CAMPOS_FISCALES,
  cuerpoFiscal,
  erroresSinNombreDeCampo,
  formularioFiscalDesde,
  type CampoFiscal,
  type FormularioFiscal,
} from '@/utils/datosFiscales'
import CamposFiscales from '@/components/CamposFiscales.vue'
import type { DatosFiscalesRespuesta } from '@/api/tipos'

const ui = useUiStore()
const catalogos = ref<DatosFiscalesRespuesta | null>(null)
const formulario = ref<FormularioFiscal | null>(null)
const guardando = ref(false)
const errores = ref<Partial<Record<CampoFiscal, string>>>({})
const erroresGenerales = ref<string[]>([])

onMounted(async () => {
  // Como el cashback, es secundario: si falla, el resto del perfil sigue.
  try {
    catalogos.value = await http.get<DatosFiscalesRespuesta>('/perfil/datos-fiscales')
    formulario.value = formularioFiscalDesde(catalogos.value)
  } catch {
    catalogos.value = null
  }
})

async function guardar(): Promise<void> {
  if (guardando.value || !formulario.value) return
  guardando.value = true
  errores.value = {}
  erroresGenerales.value = []
  try {
    catalogos.value = await http.put<DatosFiscalesRespuesta>(
      '/perfil/datos-fiscales',
      cuerpoFiscal(formulario.value),
    )
    formulario.value = formularioFiscalDesde(catalogos.value)
    ui.exito('Datos de facturación guardados')
  } catch (fallo) {
    if (!(fallo instanceof ErrorApi)) {
      ui.errorDeApi(fallo)
    } else if (fallo.mensajes.length > 0) {
      const { campos, generales } = fallo.porCampo(CAMPOS_FISCALES)
      errores.value = erroresSinNombreDeCampo(campos)
      erroresGenerales.value = generales
    } else {
      // 409 SIN_COMPRAS (aún es prospecto) o régimen que no casa con el RFC.
      erroresGenerales.value = [fallo.message]
    }
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <section v-if="catalogos && formulario" class="profile-section-card">
    <h2 class="profile-section-title">🧾 Datos de facturación</h2>
    <p class="nota">
      Tal cual aparecen en tu Constancia de Situación Fiscal. Se usan al facturar tus pedidos.
    </p>

    <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error">{{ mensaje }}</p>

    <form novalidate @submit.prevent="guardar">
      <CamposFiscales v-model="formulario" :catalogos="catalogos" :errores="errores" prefijo="pf" />

      <button type="submit" class="btn-primary guardar" :disabled="guardando">
        {{ guardando ? 'Guardando…' : 'Guardar datos de facturación' }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.profile-section-card {
  margin: 0 18px 16px;
  background: var(--white);
  border-radius: 16px;
  padding: 16px;
  box-shadow: var(--shadow);
}

.profile-section-title {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 16px;
  color: var(--sage);
  margin: 0 0 8px;
  display: flex;
  align-items: center;
  gap: 7px;
}

.nota {
  font-size: 10.5px;
  color: var(--muted);
  margin: 0 0 12px;
  line-height: 1.4;
}

.guardar {
  width: 100%;
  margin-top: 4px;
}
</style>
