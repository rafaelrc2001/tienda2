<script setup lang="ts">
/**
 * Configuración → Fiscal: RFC, nombre, régimen y CP del negocio.
 *
 * El catálogo de regímenes llega con los datos (`GET /admin/configuracion/fiscal`):
 * la interfaz no lleva su propia copia.
 */
import { computed, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import type { FiscalNegocio } from '@/api/tipos'

const ui = useUiStore()

const CAMPOS = ['rfc', 'nombre', 'regimen', 'cp'] as const

const fiscal = ref<FiscalNegocio | null>(null)
const formulario = ref({ rfc: '', nombre: '', regimen: '', cp: '' })
const cargando = ref(true)
const guardando = ref(false)
const errores = ref<Record<string, string>>({})
const erroresGenerales = ref<string[]>([])

/** Con el RFC ya escrito, solo se ofrecen los regímenes de ese tipo de persona. */
const regimenes = computed(() => {
  const todos = fiscal.value?.regimenes ?? []
  const largo = formulario.value.rfc.trim().length
  if (largo !== 12 && largo !== 13) return todos
  const persona = largo === 12 ? 'MORAL' : 'FISICA'
  return todos.filter((r) => r.personas.includes(persona) || r.clave === formulario.value.regimen)
})

function rellenar(datos: FiscalNegocio): void {
  fiscal.value = datos
  formulario.value = {
    rfc: datos.rfc ?? '',
    nombre: datos.nombre ?? '',
    regimen: datos.regimen ?? '',
    cp: datos.cp ?? '',
  }
}

onMounted(async () => {
  try {
    rellenar(await http.get<FiscalNegocio>('/admin/configuracion/fiscal'))
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
})

async function guardar(): Promise<void> {
  guardando.value = true
  errores.value = {}
  erroresGenerales.value = []
  try {
    rellenar(
      await http.put<FiscalNegocio>('/admin/configuracion/fiscal', {
        rfc: formulario.value.rfc.trim(),
        nombre: formulario.value.nombre.trim(),
        regimen: formulario.value.regimen,
        cp: formulario.value.cp.trim(),
      }),
    )
    ui.exito('Datos fiscales guardados')
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

    <template v-else-if="fiscal">
      <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error">{{ mensaje }}</p>

      <div class="form-block">
        <label class="form-label" for="fi-rfc">RFC</label>
        <input
          id="fi-rfc"
          v-model="formulario.rfc"
          class="form-input mayusculas"
          :class="{ 'is-invalid': errores.rfc }"
          maxlength="13"
          autocomplete="off"
        />
        <p v-if="errores.rfc" class="form-error">{{ errores.rfc }}</p>

        <label class="form-label" for="fi-nombre">Nombre</label>
        <input
          id="fi-nombre"
          v-model="formulario.nombre"
          class="form-input mayusculas"
          :class="{ 'is-invalid': errores.nombre }"
          placeholder="Tal cual la constancia, sin «S.A. de C.V.»"
        />
        <p v-if="errores.nombre" class="form-error">{{ errores.nombre }}</p>

        <label class="form-label" for="fi-regimen">Régimen</label>
        <select
          id="fi-regimen"
          v-model="formulario.regimen"
          class="select-input"
          :class="{ 'is-invalid': errores.regimen }"
        >
          <option value="" disabled>Elige un régimen</option>
          <option v-for="r in regimenes" :key="r.clave" :value="r.clave">
            {{ r.clave }} · {{ r.nombre }}
          </option>
        </select>
        <p v-if="errores.regimen" class="form-error">{{ errores.regimen }}</p>

        <label class="form-label" for="fi-cp">CP</label>
        <input
          id="fi-cp"
          v-model="formulario.cp"
          class="form-input"
          :class="{ 'is-invalid': errores.cp }"
          inputmode="numeric"
          maxlength="5"
        />
        <p v-if="errores.cp" class="form-error">{{ errores.cp }}</p>
      </div>

      <button type="button" class="btn-primary ancho" :disabled="guardando" @click="guardar">
        {{ guardando ? 'Guardando…' : 'Guardar datos fiscales' }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.pantalla {
  padding: 12px 18px 0;
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

.mayusculas {
  text-transform: uppercase;
}

.ancho {
  width: 100%;
}
</style>
