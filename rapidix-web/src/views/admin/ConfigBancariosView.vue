<script setup lang="ts">
/**
 * Configuración → Datos bancarios (HU-A06).
 *
 * Solo captura: los datos que aquí se guardan son los que el cliente ve al
 * confirmar un pedido por transferencia.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import type { Bancarios } from '@/api/tipos'

const ui = useUiStore()

const CAMPOS = ['banco', 'beneficiario', 'numeroCuenta', 'numeroTarjeta', 'clabe'] as const

/** Se pegan con espacios o guiones desde la app del banco; la API solo acepta dígitos. */
function soloDigitos(valor: string | null): string | null {
  return valor?.replace(/\D/g, '') || null
}

const bancarios = ref<Bancarios | null>(null)
const cargando = ref(true)
const guardando = ref(false)
const errores = ref<Record<string, string>>({})
const erroresGenerales = ref<string[]>([])

onMounted(async () => {
  try {
    bancarios.value = await http.get<Bancarios>('/admin/configuracion/bancarios')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
})

async function guardar(): Promise<void> {
  if (!bancarios.value) return
  guardando.value = true
  errores.value = {}
  erroresGenerales.value = []
  try {
    bancarios.value = await http.put<Bancarios>('/admin/configuracion/bancarios', {
      banco: bancarios.value.banco || null,
      beneficiario: bancarios.value.beneficiario || null,
      numeroCuenta: bancarios.value.numeroCuenta || null,
      numeroTarjeta: soloDigitos(bancarios.value.numeroTarjeta),
      clabe: soloDigitos(bancarios.value.clabe),
    })
    ui.exito('Datos bancarios guardados')
  } catch (fallo) {
    if (fallo instanceof ErrorApi) {
      const { campos, generales } = fallo.porCampo(CAMPOS)
      errores.value = campos
      erroresGenerales.value = generales.length > 0 ? generales : [fallo.message]
    } else {
      ui.errorDeApi(fallo)
    }
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin/configuracion" class="admin-back-inline">
      ← Volver a Configuración
    </RouterLink>

    <p v-if="cargando" class="empty-block">Cargando…</p>

    <template v-else-if="bancarios">
      <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error">{{ mensaje }}</p>

      <div class="form-block">
        <label class="form-label" for="banco">Banco</label>
        <input
          id="banco"
          v-model="bancarios.banco"
          class="form-input"
          :class="{ 'is-invalid': errores.banco }"
        />
        <p v-if="errores.banco" class="form-error">{{ errores.banco }}</p>

        <label class="form-label" for="beneficiario">Beneficiario</label>
        <input
          id="beneficiario"
          v-model="bancarios.beneficiario"
          class="form-input"
          :class="{ 'is-invalid': errores.beneficiario }"
        />
        <p v-if="errores.beneficiario" class="form-error">{{ errores.beneficiario }}</p>

        <label class="form-label" for="cuenta">Número de cuenta</label>
        <input
          id="cuenta"
          v-model="bancarios.numeroCuenta"
          class="form-input"
          :class="{ 'is-invalid': errores.numeroCuenta }"
          inputmode="numeric"
        />
        <p v-if="errores.numeroCuenta" class="form-error">{{ errores.numeroCuenta }}</p>

        <label class="form-label" for="tarjeta">Número de tarjeta</label>
        <input
          id="tarjeta"
          v-model="bancarios.numeroTarjeta"
          class="form-input"
          :class="{ 'is-invalid': errores.numeroTarjeta }"
          inputmode="numeric"
          maxlength="23"
        />
        <p v-if="errores.numeroTarjeta" class="form-error">{{ errores.numeroTarjeta }}</p>

        <label class="form-label" for="clabe">CLABE interbancaria</label>
        <input
          id="clabe"
          v-model="bancarios.clabe"
          class="form-input"
          :class="{ 'is-invalid': errores.clabe }"
          inputmode="numeric"
          maxlength="22"
        />
        <p v-if="errores.clabe" class="form-error">{{ errores.clabe }}</p>
      </div>

      <button type="button" class="btn-primary ancho" :disabled="guardando" @click="guardar">
        {{ guardando ? 'Guardando…' : 'Guardar datos bancarios' }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.pantalla {
  padding: 12px 18px 24px;
}

.admin-back-inline {
  display: inline-block;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  padding: 0 0 14px;
  text-decoration: none;
}

.form-block {
  margin: 0 0 16px;
}

.ancho {
  width: 100%;
}
</style>
