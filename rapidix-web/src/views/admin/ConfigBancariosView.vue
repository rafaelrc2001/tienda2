<script setup lang="ts">
/**
 * Configuración → Datos bancarios (HU-A06).
 *
 * Cada campo lleva su botón de copiar: es lo que el negocio dicta por
 * teléfono o pega en un chat.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import type { Bancarios } from '@/api/tipos'

const ui = useUiStore()

const CAMPOS = ['banco', 'beneficiario', 'numeroCuenta'] as const

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

async function copiar(valor: string | null, etiqueta: string): Promise<void> {
  if (!valor) return
  try {
    await navigator.clipboard.writeText(valor)
    ui.exito(`${etiqueta} copiado`)
  } catch {
    ui.error('No pudimos copiar. Cópialo a mano.')
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
        <div class="fila">
          <input
            id="banco"
            v-model="bancarios.banco"
            class="form-input"
            :class="{ 'is-invalid': errores.banco }"
          />
          <button
            type="button"
            class="btn-secondary copiar"
            :disabled="!bancarios.banco"
            @click="copiar(bancarios.banco, 'Banco')"
          >
            Copiar
          </button>
        </div>
        <p v-if="errores.banco" class="form-error">{{ errores.banco }}</p>

        <label class="form-label" for="beneficiario">Beneficiario</label>
        <div class="fila">
          <input
            id="beneficiario"
            v-model="bancarios.beneficiario"
            class="form-input"
            :class="{ 'is-invalid': errores.beneficiario }"
          />
          <button
            type="button"
            class="btn-secondary copiar"
            :disabled="!bancarios.beneficiario"
            @click="copiar(bancarios.beneficiario, 'Beneficiario')"
          >
            Copiar
          </button>
        </div>
        <p v-if="errores.beneficiario" class="form-error">{{ errores.beneficiario }}</p>

        <label class="form-label" for="cuenta">Número de cuenta</label>
        <div class="fila">
          <input
            id="cuenta"
            v-model="bancarios.numeroCuenta"
            class="form-input"
            :class="{ 'is-invalid': errores.numeroCuenta }"
            inputmode="numeric"
          />
          <button
            type="button"
            class="btn-secondary copiar"
            :disabled="!bancarios.numeroCuenta"
            @click="copiar(bancarios.numeroCuenta, 'Número de cuenta')"
          >
            Copiar
          </button>
        </div>
        <p v-if="errores.numeroCuenta" class="form-error">{{ errores.numeroCuenta }}</p>
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

.fila {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.fila .form-input {
  flex: 1;
  min-width: 0;
}

.copiar {
  flex-shrink: 0;
  height: 42px;
}

.ancho {
  width: 100%;
}
</style>
