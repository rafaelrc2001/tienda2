<script setup lang="ts">
/**
 * Configuración → Parámetros del negocio (HU-A05).
 *
 * Estos cuatro números deciden el envío y el cashback de cada pedido: son los
 * que lee `CarritoService.calcularCarrito`.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import type { Parametros } from '@/api/tipos'

const ui = useUiStore()

const CAMPOS = [
  'costoEnvio',
  'montoEnvioGratis',
  'multiplicadorCashback',
  'montoMinimoCashback',
] as const

const parametros = ref<Parametros | null>(null)
const cargando = ref(true)
const guardando = ref(false)
const errores = ref<Record<string, string>>({})
const erroresGenerales = ref<string[]>([])

onMounted(async () => {
  try {
    parametros.value = await http.get<Parametros>('/admin/configuracion/parametros')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
})

async function guardar(): Promise<void> {
  if (!parametros.value) return
  guardando.value = true
  errores.value = {}
  erroresGenerales.value = []
  try {
    parametros.value = await http.put<Parametros>(
      '/admin/configuracion/parametros',
      parametros.value,
    )
    ui.exito('Parámetros guardados')
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

    <template v-else-if="parametros">
      <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error">{{ mensaje }}</p>

      <div class="form-block">
        <label class="form-label" for="costo">Costo de envío</label>
        <input
          id="costo"
          v-model.number="parametros.costoEnvio"
          class="form-input"
          :class="{ 'is-invalid': errores.costoEnvio }"
          type="number"
          step="0.01"
          min="0"
        />
        <p v-if="errores.costoEnvio" class="form-error">{{ errores.costoEnvio }}</p>

        <label class="form-label" for="gratis">Envío gratis a partir de</label>
        <input
          id="gratis"
          v-model.number="parametros.montoEnvioGratis"
          class="form-input"
          :class="{ 'is-invalid': errores.montoEnvioGratis }"
          type="number"
          step="0.01"
          min="0"
        />
        <p v-if="errores.montoEnvioGratis" class="form-error">{{ errores.montoEnvioGratis }}</p>
        <p class="nota">
          El envío gratis se evalúa sobre el subtotal <strong>antes</strong> del descuento: un cupón
          no hace perder el envío gratis.
        </p>
      </div>

      <div class="form-block">
        <label class="form-label" for="multiplicador">Cashback (% del subtotal)</label>
        <input
          id="multiplicador"
          v-model.number="parametros.multiplicadorCashback"
          class="form-input"
          :class="{ 'is-invalid': errores.multiplicadorCashback }"
          type="number"
          step="0.01"
          min="0"
        />
        <p v-if="errores.multiplicadorCashback" class="form-error">
          {{ errores.multiplicadorCashback }}
        </p>
        <p class="nota">
          El campo se llamaba «multiplicador» en el prototipo, pero se interpreta como porcentaje
          sobre el subtotal. Con 2 se acredita el 2 %.
        </p>

        <label class="form-label" for="minimo">Compra mínima para generar cashback</label>
        <input
          id="minimo"
          v-model.number="parametros.montoMinimoCashback"
          class="form-input"
          :class="{ 'is-invalid': errores.montoMinimoCashback }"
          type="number"
          step="0.01"
          min="0"
        />
        <p v-if="errores.montoMinimoCashback" class="form-error">
          {{ errores.montoMinimoCashback }}
        </p>
      </div>

      <div class="form-block">
        <div class="toggle-row">
          <div>
            <div class="t-lbl">Descontar inventario al vender</div>
            <div class="t-sub">
              Cada pedido resta de la bodega y deja su movimiento. Si a un producto no le alcanza
              el saldo, el pedido no se confirma.
            </div>
          </div>
          <label class="switch">
            <input v-model="parametros.controlInventario" type="checkbox" />
            <span class="slider-switch" />
          </label>
        </div>
        <p class="nota">
          Enciéndelo <strong>después</strong> de capturar la existencia real en Productos →
          Movimientos. Con todos los productos en cero, encenderlo bloquea todas las ventas.
        </p>
      </div>

      <button type="button" class="btn-primary ancho" :disabled="guardando" @click="guardar">
        {{ guardando ? 'Guardando…' : 'Guardar parámetros' }}
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

.nota {
  font-size: 10.5px;
  color: var(--muted);
  line-height: 1.45;
  margin: -4px 0 0;
}

.toggle-row + .nota {
  margin-top: -6px;
}

.nota strong {
  color: var(--ink);
}

.ancho {
  width: 100%;
}
</style>
