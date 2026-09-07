<script setup lang="ts">
/**
 * Configuración → Horario de servicio (HU-A04).
 *
 * Los días y las horas deciden si un pedido lleva recargo: es la misma
 * configuración que lee `POST /carrito/previsualizar`.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import type { ClaveDia, Horario } from '@/api/tipos'

const ui = useUiStore()

const CAMPOS = ['abre', 'cierra', 'incrementoFuera', 'whatsappAyuda', 'diasServicio'] as const

const DIAS: { clave: ClaveDia; etiqueta: string }[] = [
  { clave: 'lun', etiqueta: 'Lun' },
  { clave: 'mar', etiqueta: 'Mar' },
  { clave: 'mie', etiqueta: 'Mié' },
  { clave: 'jue', etiqueta: 'Jue' },
  { clave: 'vie', etiqueta: 'Vie' },
  { clave: 'sab', etiqueta: 'Sáb' },
  { clave: 'dom', etiqueta: 'Dom' },
]

const horario = ref<Horario | null>(null)
const cargando = ref(true)
const guardando = ref(false)
const errores = ref<Record<string, string>>({})
const erroresGenerales = ref<string[]>([])

onMounted(async () => {
  try {
    horario.value = await http.get<Horario>('/admin/configuracion/horario')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
})

function alternarDia(clave: ClaveDia): void {
  if (!horario.value) return
  horario.value.diasServicio[clave] = !horario.value.diasServicio[clave]
}

async function guardar(): Promise<void> {
  if (!horario.value) return
  guardando.value = true
  errores.value = {}
  erroresGenerales.value = []
  try {
    horario.value = await http.put<Horario>('/admin/configuracion/horario', {
      diasServicio: horario.value.diasServicio,
      abre: horario.value.abre,
      cierra: horario.value.cierra,
      atenderFuera: horario.value.atenderFuera,
      incrementoFuera: horario.value.incrementoFuera,
      whatsappAyuda: horario.value.whatsappAyuda || null,
    })
    ui.exito('Horario guardado')
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

    <template v-else-if="horario">
      <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error">{{ mensaje }}</p>

      <div class="form-block">
        <label class="form-label">Días de servicio</label>
        <div class="dias">
          <button
            v-for="dia in DIAS"
            :key="dia.clave"
            type="button"
            class="dia"
            :class="{ activo: horario.diasServicio[dia.clave] }"
            @click="alternarDia(dia.clave)"
          >
            {{ dia.etiqueta }}
          </button>
        </div>

        <div class="form-row-2">
          <div>
            <label class="form-label" for="abre">Abre</label>
            <input
              id="abre"
              v-model="horario.abre"
              class="form-input"
              :class="{ 'is-invalid': errores.abre }"
              type="time"
            />
            <p v-if="errores.abre" class="form-error">{{ errores.abre }}</p>
          </div>
          <div>
            <label class="form-label" for="cierra">Cierra</label>
            <input
              id="cierra"
              v-model="horario.cierra"
              class="form-input"
              :class="{ 'is-invalid': errores.cierra }"
              type="time"
            />
            <p v-if="errores.cierra" class="form-error">{{ errores.cierra }}</p>
          </div>
        </div>
        <p class="nota">Un horario que cierra antes de abrir se entiende como que cruza la medianoche.</p>
      </div>

      <div class="form-block">
        <div class="toggle-row sin-margen">
          <div>
            <p class="t-lbl">Atender fuera de horario</p>
            <p class="t-sub">Si está apagado, fuera del horario no se pueden confirmar pedidos.</p>
          </div>
          <label class="switch">
            <input v-model="horario.atenderFuera" type="checkbox" />
            <span class="slider-switch" />
          </label>
        </div>

        <label class="form-label recargo-label" for="incremento">
          Recargo fuera de horario (%)
        </label>
        <input
          id="incremento"
          v-model.number="horario.incrementoFuera"
          class="form-input"
          :class="{ 'is-invalid': errores.incrementoFuera }"
          type="number"
          step="0.01"
          min="0"
        />
        <p v-if="errores.incrementoFuera" class="form-error">{{ errores.incrementoFuera }}</p>
      </div>

      <div class="form-block">
        <label class="form-label" for="whatsapp">WhatsApp de ayuda</label>
        <input
          id="whatsapp"
          v-model="horario.whatsappAyuda"
          class="form-input"
          :class="{ 'is-invalid': errores.whatsappAyuda }"
          type="tel"
          placeholder="Ej. 9211234567"
        />
        <p v-if="errores.whatsappAyuda" class="form-error">{{ errores.whatsappAyuda }}</p>
      </div>

      <button type="button" class="btn-primary ancho" :disabled="guardando" @click="guardar">
        {{ guardando ? 'Guardando…' : 'Guardar horario' }}
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

.dias {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 5px;
  margin-bottom: 14px;
}

.dia {
  padding: 9px 2px;
  border-radius: 10px;
  border: 1.5px solid var(--line);
  background: var(--cream);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 10.5px;
  color: var(--muted);
  cursor: pointer;
}

.dia.activo {
  background: var(--sage);
  border-color: var(--sage);
  color: var(--white);
}

.sin-margen {
  margin-bottom: 0;
  box-shadow: none;
  background: var(--cream);
}

.recargo-label {
  margin-top: 14px;
}

.nota {
  font-size: 10.5px;
  color: var(--muted);
  line-height: 1.45;
  margin: -4px 0 0;
}

.ancho {
  width: 100%;
}
</style>
