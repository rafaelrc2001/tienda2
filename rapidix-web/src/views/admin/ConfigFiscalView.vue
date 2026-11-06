<script setup lang="ts">
/**
 * Configuración → Fiscal → Razones sociales: los emisores con los que factura
 * el negocio. Cada una con su RFC, nombre, régimen y CP, y sus llaves de
 * factura.com (en factura.com cada RFC es una cuenta con llaves propias).
 *
 * La **principal** es la que usan Mis pedidos, Finanzas y la factura global; el
 * punto de venta elige entre las activas. Sin llaves propias, la principal
 * timbra con las del servidor y las demás en modo demostración. Las llaves se
 * escriben y nunca vuelven: al editar llegan vacías, y vacías se conservan.
 *
 * El catálogo de regímenes llega con los datos: la interfaz no lleva copia, y
 * cada respuesta trae la lista completa para repintar con una sola petición.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import SkeletonList from '@/components/SkeletonList.vue'
import type { RazonesSociales, RazonSocial } from '@/api/tipos'
import PestanasFiscal from './fiscal/PestanasFiscal.vue'

const ui = useUiStore()

const BASE = '/admin/configuracion/razones-sociales'
const CAMPOS = [
  'rfc',
  'nombre',
  'regimen',
  'cp',
  'facturaComApiKey',
  'facturaComSecretKey',
  'facturaComSerie',
] as const

const datos = ref<RazonesSociales | null>(null)
const cargando = ref(true)

onMounted(async () => {
  try {
    datos.value = await http.get<RazonesSociales>(BASE)
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
})

function nombreRegimen(clave: string): string {
  const r = datos.value?.regimenes.find((x) => x.clave === clave)
  return r ? `${clave} · ${r.nombre}` : clave
}

function comoTimbra(r: RazonSocial): string {
  if (r.modo === 'SIMULADO') return 'Demostración'
  if (!r.facturaCom.llavesPropias) return 'factura.com (llaves del servidor)'
  return r.facturaCom.produccion ? 'factura.com · producción' : 'factura.com · sandbox'
}

// ------------------------------------------------------------------
// Alta y edición
// ------------------------------------------------------------------

/** `null` sin formulario abierto; `'nueva'` para el alta; si no, la que se edita. */
const editando = ref<RazonSocial | 'nueva' | null>(null)
const guardando = ref(false)
const errores = ref<Record<string, string>>({})
const erroresGenerales = ref<string[]>([])

function vacio() {
  return {
    rfc: '',
    nombre: '',
    regimen: '',
    cp: '',
    principal: false,
    activa: true,
    facturaComApiKey: '',
    facturaComSecretKey: '',
    facturaComSerie: '',
    facturaComProduccion: false,
    quitarLlaves: false,
  }
}

const formulario = ref(vacio())
const existente = computed(() =>
  editando.value && editando.value !== 'nueva' ? editando.value : null,
)

function abrir(r: RazonSocial | 'nueva'): void {
  editando.value = r
  errores.value = {}
  erroresGenerales.value = []
  formulario.value =
    r === 'nueva'
      ? { ...vacio(), principal: (datos.value?.razones.length ?? 0) === 0 }
      : {
          ...vacio(),
          rfc: r.rfc,
          nombre: r.nombre,
          regimen: r.regimen,
          cp: r.cp,
          principal: r.principal,
          activa: r.activa,
          facturaComSerie: r.facturaCom.serie ?? '',
          facturaComProduccion: r.facturaCom.produccion,
        }
}

function cerrar(): void {
  editando.value = null
}

/** El RFC sin espacios ni guiones, que es como lo guarda la API. */
const rfcLimpio = computed(() => formulario.value.rfc.replace(/[\s-]/g, '').toUpperCase())

/** Con el RFC ya escrito, solo se ofrecen los regímenes de ese tipo de persona. */
const regimenes = computed(() => {
  const todos = datos.value?.regimenes ?? []
  const largo = rfcLimpio.value.length
  if (largo !== 12 && largo !== 13) return todos
  const persona = largo === 12 ? 'MORAL' : 'FISICA'
  return todos.filter((r) => r.personas.includes(persona))
})

/**
 * Si el RFC cambia de persona física a moral (o al revés), el régimen elegido
 * deja de valer: se vacía para que no se guarde uno que el SAT rechaza.
 */
watch(regimenes, (lista) => {
  if (formulario.value.regimen && !lista.some((r) => r.clave === formulario.value.regimen)) {
    formulario.value.regimen = ''
  }
})

async function guardar(): Promise<void> {
  if (guardando.value || !editando.value) return
  guardando.value = true
  errores.value = {}
  erroresGenerales.value = []
  const f = formulario.value
  const cuerpo = {
    rfc: rfcLimpio.value,
    nombre: f.nombre.trim(),
    regimen: f.regimen,
    cp: f.cp.trim(),
    principal: f.principal,
    activa: f.activa,
    // Vacías se conservan las que había: la API no las devuelve nunca.
    facturaComApiKey: f.facturaComApiKey.trim(),
    facturaComSecretKey: f.facturaComSecretKey.trim(),
    facturaComSerie: f.facturaComSerie.trim(),
    facturaComProduccion: f.facturaComProduccion,
    quitarLlaves: f.quitarLlaves,
  }
  try {
    datos.value = existente.value
      ? await http.put<RazonesSociales>(`${BASE}/${existente.value.id}`, cuerpo)
      : await http.post<RazonesSociales>(BASE, cuerpo)
    ui.exito(existente.value ? 'Razón social guardada' : 'Razón social agregada')
    cerrar()
  } catch (fallo) {
    if (fallo instanceof ErrorApi) {
      const { campos, generales } = fallo.porCampo(CAMPOS)
      errores.value = campos
      erroresGenerales.value =
        generales.length > 0 ? generales : Object.keys(campos).length ? [] : [fallo.message]
    } else {
      ui.errorDeApi(fallo)
    }
  } finally {
    guardando.value = false
  }
}

const eliminando = ref<string | null>(null)

async function eliminar(r: RazonSocial): Promise<void> {
  if (eliminando.value) return
  if (!window.confirm(`¿Eliminar ${r.nombre} (${r.rfc})?`)) return
  eliminando.value = r.id
  try {
    datos.value = await http.delete<RazonesSociales>(`${BASE}/${r.id}`)
    ui.exito('Razón social eliminada')
    if (existente.value?.id === r.id) cerrar()
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    eliminando.value = null
  }
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin/configuracion" class="admin-back-inline">
      ← Volver a Configuración
    </RouterLink>

    <PestanasFiscal activa="datos" />

    <SkeletonList v-if="cargando" :cantidad="2" />

    <template v-else-if="datos">
      <div class="encabezado">
        <p class="ayuda">
          La <strong>principal</strong> factura Mis pedidos, Finanzas y la factura global; en el
          punto de venta se elige entre las activas.
        </p>
        <button v-if="!editando" type="button" class="btn-primary agregar" @click="abrir('nueva')">
          ＋ Agregar razón social
        </button>
      </div>

      <div v-if="datos.razones.length > 0" class="tabla-envoltorio">
        <table class="tabla lineal">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>RFC</th>
              <th>Régimen</th>
              <th>CP</th>
              <th>Timbra con</th>
              <th class="num">Facturas</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in datos.razones" :key="r.id" :class="{ inactiva: !r.activa }">
              <td class="nombre">
                {{ r.nombre }}
                <span v-if="r.principal" class="mini-tag">Principal</span>
                <span v-if="!r.activa" class="mini-tag apagada">Inactiva</span>
              </td>
              <td class="rfc">{{ r.rfc }}</td>
              <td>{{ nombreRegimen(r.regimen) }}</td>
              <td class="rfc">{{ r.cp }}</td>
              <td :class="{ demo: r.modo === 'SIMULADO' }">{{ comoTimbra(r) }}</td>
              <td class="num">{{ r.facturas }}</td>
              <td class="acciones">
                <button type="button" class="enlace" @click="abrir(r)">Editar</button>
                <button
                  v-if="!r.principal && r.facturas === 0"
                  type="button"
                  class="enlace peligro"
                  :disabled="eliminando !== null"
                  @click="eliminar(r)"
                >
                  {{ eliminando === r.id ? '…' : 'Eliminar' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-else-if="!editando" class="empty-block">
        Todavía no hay razones sociales. Mientras tanto se factura con el emisor de pruebas del
        servidor.
      </p>

      <!-- Bloque gris con los campos blancos: aquí se captura. -->
      <form v-if="editando" class="form-block" novalidate @submit.prevent="guardar">
        <p class="titulo-form">
          {{ existente ? `Editar ${existente.nombre}` : 'Nueva razón social' }}
        </p>

        <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error">{{ mensaje }}</p>

        <label class="form-label" for="rs-rfc">RFC</label>
        <input
          id="rs-rfc"
          v-model="formulario.rfc"
          class="form-input mayusculas"
          :class="{ 'is-invalid': errores.rfc }"
          maxlength="16"
          autocomplete="off"
        />
        <p v-if="errores.rfc" class="form-error">{{ errores.rfc }}</p>

        <label class="form-label" for="rs-nombre">Nombre</label>
        <input
          id="rs-nombre"
          v-model="formulario.nombre"
          class="form-input mayusculas"
          :class="{ 'is-invalid': errores.nombre }"
          maxlength="254"
          placeholder="Tal cual la constancia, sin «S.A. de C.V.»"
        />
        <p v-if="errores.nombre" class="form-error">{{ errores.nombre }}</p>

        <label class="form-label" for="rs-regimen">Régimen</label>
        <select
          id="rs-regimen"
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

        <label class="form-label" for="rs-cp">CP</label>
        <input
          id="rs-cp"
          v-model="formulario.cp"
          class="form-input"
          :class="{ 'is-invalid': errores.cp }"
          inputmode="numeric"
          maxlength="5"
        />
        <p v-if="errores.cp" class="form-error">{{ errores.cp }}</p>

        <label class="casilla">
          <input
            v-model="formulario.principal"
            type="checkbox"
            :disabled="existente?.principal === true"
          />
          Principal
          <span class="pista">
            {{
              existente?.principal
                ? 'Para cambiarla, marca otra como principal.'
                : 'Mis pedidos, Finanzas y la factura global facturan con ella.'
            }}
          </span>
        </label>
        <label class="casilla">
          <input v-model="formulario.activa" type="checkbox" :disabled="formulario.principal" />
          Activa
          <span class="pista">Apagada deja de ofrecerse en el punto de venta.</span>
        </label>

        <p class="titulo-form sub">Llaves de factura.com</p>
        <p class="pista bloque">
          De la cuenta de factura.com de este RFC. Sin ellas
          <template v-if="formulario.principal && datos.llavesDeEntorno">
            timbra con las llaves del servidor.
          </template>
          <template v-else>la factura sale en modo demostración, sin validez fiscal.</template>
          <template v-if="existente?.facturaCom.llavesPropias">
            Ya tiene llaves guardadas: deja los campos vacíos para conservarlas.
          </template>
        </p>

        <label class="form-label" for="rs-api">API key</label>
        <input
          id="rs-api"
          v-model="formulario.facturaComApiKey"
          class="form-input"
          :class="{ 'is-invalid': errores.facturaComApiKey }"
          type="password"
          autocomplete="off"
          :disabled="formulario.quitarLlaves"
          :placeholder="existente?.facturaCom.llavesPropias ? 'Guardada' : ''"
        />
        <p v-if="errores.facturaComApiKey" class="form-error">{{ errores.facturaComApiKey }}</p>

        <label class="form-label" for="rs-secret">Secret key</label>
        <input
          id="rs-secret"
          v-model="formulario.facturaComSecretKey"
          class="form-input"
          :class="{ 'is-invalid': errores.facturaComSecretKey }"
          type="password"
          autocomplete="off"
          :disabled="formulario.quitarLlaves"
          :placeholder="existente?.facturaCom.llavesPropias ? 'Guardada' : ''"
        />
        <p v-if="errores.facturaComSecretKey" class="form-error">
          {{ errores.facturaComSecretKey }}
        </p>

        <label class="form-label" for="rs-serie">Serie (id de la serie en el panel)</label>
        <input
          id="rs-serie"
          v-model="formulario.facturaComSerie"
          class="form-input"
          :class="{ 'is-invalid': errores.facturaComSerie }"
          inputmode="numeric"
          autocomplete="off"
          :disabled="formulario.quitarLlaves"
        />
        <p v-if="errores.facturaComSerie" class="form-error">{{ errores.facturaComSerie }}</p>

        <label class="casilla">
          <input v-model="formulario.facturaComProduccion" type="checkbox" />
          Producción
          <span class="pista">Sin palomear se timbra en el sandbox de factura.com.</span>
        </label>
        <label v-if="existente?.facturaCom.llavesPropias" class="casilla">
          <input v-model="formulario.quitarLlaves" type="checkbox" />
          Quitar las llaves guardadas
        </label>

        <div class="acciones-form">
          <button type="button" class="btn-cancel" :disabled="guardando" @click="cerrar">
            Cancelar
          </button>
          <button type="submit" class="btn-primary" :disabled="guardando">
            {{ guardando ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </form>
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

.encabezado {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  margin-bottom: 12px;
}

.ayuda {
  margin: 0;
  flex: 1 1 240px;
  font-size: 12px;
  color: var(--muted);
}

.agregar {
  flex: 0 0 auto;
  width: auto;
  padding: 9px 14px;
}

.tabla {
  min-width: 760px;
}

.tabla .rfc {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.tabla .nombre .mini-tag {
  margin-left: 4px;
}

.mini-tag.apagada {
  color: var(--muted);
}

.tabla .inactiva > td {
  color: var(--muted);
}

.demo {
  color: var(--orange-dark);
}

.acciones {
  white-space: nowrap;
}

.acciones .enlace + .enlace {
  margin-left: 10px;
}

.enlace.peligro {
  color: var(--rojo);
}

.form-block {
  margin: 12px 0 16px;
}

.titulo-form {
  margin: 0 0 12px;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 14px;
  color: var(--ink);
}

.titulo-form.sub {
  margin-top: 8px;
  font-size: 13px;
}

.mayusculas {
  text-transform: uppercase;
}

.casilla {
  display: block;
  margin: 0 0 10px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  color: var(--ink);
  cursor: pointer;
}

.casilla input {
  margin: 0 6px 0 0;
  accent-color: var(--terracotta);
  vertical-align: -2px;
}

.pista {
  display: block;
  margin-top: 2px;
  font-family: var(--font-body);
  font-weight: 400;
  font-size: 11px;
  color: var(--muted);
}

.pista.bloque {
  margin: -6px 0 10px;
}

.acciones-form {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}

.acciones-form .btn-primary {
  flex: 1;
}
</style>
