<script setup lang="ts">
/**
 * Configuración → Datos bancarios (HU-A06).
 *
 * Un solo directorio de cuentas del negocio («Cuentas bancarias»): cada cuenta
 * se captura una vez con banco, número, titular y, si se le va a dar al
 * cliente, tarjeta (depósito en OXXO y similares) y CLABE (SPEI). De ese mismo
 * directorio salen las cuentas de Finanzas → Bancos.
 *
 * Arriba se eligen las dos cuentas a las que transfiere el cliente:
 *  - Principal: la de quien marca «Requiero factura» en el carrito.
 *  - Secundaria: la de quien no la pide. Sin ella, se le da la principal.
 * Solo se ofrecen cuentas con tarjeta o CLABE: sin ellas no hay cómo pagar.
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import type { CuentaBancaria, DatosBancariosNegocio } from '@/api/tipos'

const ui = useUiStore()

const CAMPOS_CUENTA = ['banco', 'numeroCuenta', 'titular', 'numeroTarjeta', 'clabe'] as const

type FormularioCuenta = Record<(typeof CAMPOS_CUENTA)[number], string>

const vacio = (): FormularioCuenta => ({
  banco: '',
  numeroCuenta: '',
  titular: '',
  numeroTarjeta: '',
  clabe: '',
})

const cargando = ref(true)
const cuentas = ref<CuentaBancaria[]>([])

// ---- Cuentas para transferir ----

const elegidas = ref<DatosBancariosNegocio>({ cuentaPrincipalId: null, cuentaSecundariaId: null })
const guardandoElegidas = ref(false)
const erroresElegidas = ref<string[]>([])

const sirveParaCobrar = (c: CuentaBancaria) => !!(c.numeroTarjeta || c.clabe)

/** Las que se pueden dar al cliente: con tarjeta o CLABE. */
const cuentasParaCobrar = computed(() => cuentas.value.filter(sirveParaCobrar))

function nombreCuenta(c: CuentaBancaria): string {
  return `${c.banco} · ${c.numeroCuenta} · ${c.titular}`
}

/** «Principal», «Secundaria» o las dos, para la pastilla de la tabla. */
function usoDe(c: CuentaBancaria): string | null {
  const usos = [
    elegidas.value.cuentaPrincipalId === c.id ? 'Principal' : null,
    elegidas.value.cuentaSecundariaId === c.id ? 'Secundaria' : null,
  ].filter(Boolean)
  return usos.length > 0 ? usos.join(' y ') : null
}

async function guardarElegidas(): Promise<void> {
  guardandoElegidas.value = true
  erroresElegidas.value = []
  try {
    elegidas.value = await http.put<DatosBancariosNegocio>(
      '/admin/configuracion/bancarios',
      elegidas.value,
    )
    ui.exito('Cuentas para transferir guardadas')
  } catch (fallo) {
    if (fallo instanceof ErrorApi) erroresElegidas.value = [fallo.message]
    else ui.errorDeApi(fallo)
  } finally {
    guardandoElegidas.value = false
  }
}

// ---- Directorio: alta y edición ----

const formulario = ref<FormularioCuenta>(vacio())
/** La cuenta que se está editando; `null` es alta. */
const editandoId = ref<string | null>(null)
const guardandoCuenta = ref(false)
const erroresCuenta = ref<Record<string, string>>({})
const erroresCuentaGenerales = ref<string[]>([])
const bloqueFormulario = ref<HTMLElement | null>(null)

onMounted(async () => {
  try {
    ;[elegidas.value, cuentas.value] = await Promise.all([
      http.get<DatosBancariosNegocio>('/admin/configuracion/bancarios'),
      http.get<CuentaBancaria[]>('/admin/configuracion/cuentas-bancarias'),
    ])
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
})

/** Se pegan con espacios o guiones desde la app del banco; la API solo acepta dígitos. */
const soloDigitos = (valor: string) => valor.replace(/\D/g, '')

/** Las mismas reglas de la API para tarjeta y CLABE, revisadas antes de mandar. */
function validarCuenta(): Record<string, string> {
  const encontrados: Record<string, string> = {}
  const tarjeta = soloDigitos(formulario.value.numeroTarjeta)
  const clabe = soloDigitos(formulario.value.clabe)
  if (tarjeta && !/^\d{15,19}$/.test(tarjeta)) {
    encontrados.numeroTarjeta = 'El número de tarjeta debe tener entre 15 y 19 dígitos'
  }
  if (clabe && !/^\d{18}$/.test(clabe)) {
    encontrados.clabe = 'La CLABE debe tener 18 dígitos'
  }
  return encontrados
}

function limpiarFormulario(): void {
  formulario.value = vacio()
  editandoId.value = null
  erroresCuenta.value = {}
  erroresCuentaGenerales.value = []
}

async function editarCuenta(cuenta: CuentaBancaria): Promise<void> {
  limpiarFormulario()
  editandoId.value = cuenta.id
  formulario.value = {
    banco: cuenta.banco,
    numeroCuenta: cuenta.numeroCuenta,
    titular: cuenta.titular,
    numeroTarjeta: cuenta.numeroTarjeta ?? '',
    clabe: cuenta.clabe ?? '',
  }
  // Quien hace scroll es `.app-screen`: scrollIntoView lo encuentra solo.
  await nextTick()
  bloqueFormulario.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function guardarCuenta(): Promise<void> {
  erroresCuenta.value = validarCuenta()
  erroresCuentaGenerales.value = []
  if (Object.keys(erroresCuenta.value).length > 0) return
  guardandoCuenta.value = true
  const cuerpo = {
    banco: formulario.value.banco.trim(),
    numeroCuenta: soloDigitos(formulario.value.numeroCuenta),
    titular: formulario.value.titular.trim(),
    numeroTarjeta: soloDigitos(formulario.value.numeroTarjeta) || null,
    clabe: soloDigitos(formulario.value.clabe) || null,
  }
  try {
    if (editandoId.value) {
      const cuenta = await http.put<CuentaBancaria>(
        `/admin/configuracion/cuentas-bancarias/${editandoId.value}`,
        cuerpo,
      )
      cuentas.value = cuentas.value.map((c) => (c.id === cuenta.id ? cuenta : c))
      ui.exito('Cuenta bancaria actualizada')
    } else {
      const cuenta = await http.post<CuentaBancaria>(
        '/admin/configuracion/cuentas-bancarias',
        cuerpo,
      )
      cuentas.value.push(cuenta)
      ui.exito('Cuenta bancaria agregada')
    }
    limpiarFormulario()
  } catch (fallo) {
    if (fallo instanceof ErrorApi) {
      const { campos, generales } = fallo.porCampo(CAMPOS_CUENTA)
      erroresCuenta.value = campos
      erroresCuentaGenerales.value = generales.length > 0 ? generales : [fallo.message]
    } else {
      ui.errorDeApi(fallo)
    }
  } finally {
    guardandoCuenta.value = false
  }
}

async function eliminarCuenta(cuenta: CuentaBancaria): Promise<void> {
  if (!confirm(`¿Eliminar la cuenta ${cuenta.numeroCuenta} de ${cuenta.banco}?`)) return
  try {
    await http.delete(`/admin/configuracion/cuentas-bancarias/${cuenta.id}`)
    cuentas.value = cuentas.value.filter((c) => c.id !== cuenta.id)
    if (editandoId.value === cuenta.id) limpiarFormulario()
    ui.exito('Cuenta bancaria eliminada')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  }
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin/configuracion" class="admin-back-inline">
      ← Volver a Configuración
    </RouterLink>

    <p v-if="cargando" class="empty-block">Cargando…</p>

    <template v-else>
      <!-- ---- Las dos cuentas que ve el cliente al transferir ---- -->
      <h2 class="titulo-seccion primero">Cuentas para transferir</h2>
      <p class="ayuda">
        Se eligen del directorio de abajo. Solo aparecen las cuentas con tarjeta o CLABE.
      </p>

      <p v-for="(mensaje, i) in erroresElegidas" :key="i" class="form-error">{{ mensaje }}</p>

      <div class="form-block">
        <label class="form-label" for="cuenta-principal">Cuenta principal · con factura</label>
        <select id="cuenta-principal" v-model="elegidas.cuentaPrincipalId" class="form-input">
          <option :value="null">Sin cuenta</option>
          <option v-for="c in cuentasParaCobrar" :key="c.id" :value="c.id">
            {{ nombreCuenta(c) }}
          </option>
        </select>
        <p class="ayuda campo">Se le da al cliente que marca «Requiero factura».</p>

        <label class="form-label" for="cuenta-secundaria">Cuenta secundaria · sin factura</label>
        <select id="cuenta-secundaria" v-model="elegidas.cuentaSecundariaId" class="form-input">
          <option :value="null">Ninguna · se da la principal</option>
          <option v-for="c in cuentasParaCobrar" :key="c.id" :value="c.id">
            {{ nombreCuenta(c) }}
          </option>
        </select>
        <p class="ayuda campo">Se le da al cliente que no pide factura.</p>

        <p v-if="cuentasParaCobrar.length === 0" class="ayuda campo">
          Da de alta abajo una cuenta con tarjeta o CLABE para poder elegirla.
        </p>
      </div>

      <button
        type="button"
        class="btn-primary ancho"
        :disabled="guardandoElegidas"
        @click="guardarElegidas"
      >
        {{ guardandoElegidas ? 'Guardando…' : 'Guardar cuentas para transferir' }}
      </button>

      <!-- ---- Directorio único de cuentas ---- -->
      <h2 ref="bloqueFormulario" class="titulo-seccion">
        {{ editandoId ? 'Editar cuenta bancaria' : 'Cuentas bancarias' }}
      </h2>
      <p class="ayuda">
        Cada cuenta se captura una vez: sirve para Finanzas → Bancos y, con tarjeta o CLABE, para
        dársela al cliente.
      </p>

      <p v-for="(mensaje, i) in erroresCuentaGenerales" :key="i" class="form-error">
        {{ mensaje }}
      </p>

      <div class="form-block">
        <label class="form-label" for="cb-banco">Banco</label>
        <input
          id="cb-banco"
          v-model="formulario.banco"
          class="form-input"
          :class="{ 'is-invalid': erroresCuenta.banco }"
          maxlength="80"
          placeholder="Ej. BBVA"
        />
        <p v-if="erroresCuenta.banco" class="form-error">{{ erroresCuenta.banco }}</p>

        <label class="form-label" for="cb-cuenta">Número de cuenta</label>
        <input
          id="cb-cuenta"
          v-model="formulario.numeroCuenta"
          class="form-input"
          :class="{ 'is-invalid': erroresCuenta.numeroCuenta }"
          inputmode="numeric"
          maxlength="26"
        />
        <p v-if="erroresCuenta.numeroCuenta" class="form-error">
          {{ erroresCuenta.numeroCuenta }}
        </p>

        <label class="form-label" for="cb-titular">Titular (beneficiario)</label>
        <input
          id="cb-titular"
          v-model="formulario.titular"
          class="form-input"
          :class="{ 'is-invalid': erroresCuenta.titular }"
          maxlength="120"
          placeholder="Nombre de quien es la cuenta"
        />
        <p v-if="erroresCuenta.titular" class="form-error">{{ erroresCuenta.titular }}</p>

        <label class="form-label" for="cb-tarjeta">Número de tarjeta (depósito) · opcional</label>
        <input
          id="cb-tarjeta"
          v-model="formulario.numeroTarjeta"
          class="form-input"
          :class="{ 'is-invalid': erroresCuenta.numeroTarjeta }"
          inputmode="numeric"
          maxlength="23"
        />
        <p v-if="erroresCuenta.numeroTarjeta" class="form-error">
          {{ erroresCuenta.numeroTarjeta }}
        </p>

        <label class="form-label" for="cb-clabe">
          CLABE interbancaria (transferencia) · opcional
        </label>
        <input
          id="cb-clabe"
          v-model="formulario.clabe"
          class="form-input"
          :class="{ 'is-invalid': erroresCuenta.clabe }"
          inputmode="numeric"
          maxlength="22"
        />
        <p v-if="erroresCuenta.clabe" class="form-error">{{ erroresCuenta.clabe }}</p>
      </div>

      <div class="acciones-formulario">
        <button
          v-if="editandoId"
          type="button"
          class="btn-secondary"
          :disabled="guardandoCuenta"
          @click="limpiarFormulario"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="btn-primary ancho"
          :disabled="guardandoCuenta"
          @click="guardarCuenta"
        >
          {{
            guardandoCuenta
              ? 'Guardando…'
              : editandoId
                ? 'Guardar cambios'
                : '+ Dar de alta cuenta bancaria'
          }}
        </button>
      </div>

      <div v-if="cuentas.length > 0" class="tabla-envoltorio lista-cuentas">
        <table class="tabla">
          <thead>
            <tr>
              <th>Banco</th>
              <th>Número de cuenta</th>
              <th>Titular</th>
              <th>Tarjeta</th>
              <th>CLABE</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="cuenta in cuentas"
              :key="cuenta.id"
              :class="{ editando: cuenta.id === editandoId }"
            >
              <td>
                <span class="folio">{{ cuenta.banco }}</span>
                <span v-if="usoDe(cuenta)" class="pastilla uso">{{ usoDe(cuenta) }}</span>
              </td>
              <td>{{ cuenta.numeroCuenta }}</td>
              <td>{{ cuenta.titular }}</td>
              <td>{{ cuenta.numeroTarjeta ?? '—' }}</td>
              <td>{{ cuenta.clabe ?? '—' }}</td>
              <td class="num acciones">
                <button
                  type="button"
                  class="accion"
                  :aria-label="`Editar la cuenta ${cuenta.numeroCuenta}`"
                  @click="editarCuenta(cuenta)"
                >
                  ✏️
                </button>
                <button
                  type="button"
                  class="accion"
                  :aria-label="`Eliminar la cuenta ${cuenta.numeroCuenta}`"
                  @click="eliminarCuenta(cuenta)"
                >
                  🗑️
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-else class="empty-block lista-cuentas">
        Todavía no hay cuentas bancarias dadas de alta.
      </p>
    </template>
  </div>
</template>

<style scoped>
.pantalla {
  padding: 12px 18px 0;
}

.titulo-seccion {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 15px;
  color: var(--ink);
  margin: 24px 0 10px;
  scroll-margin-top: 12px;
}

.titulo-seccion.primero {
  margin-top: 0;
}

.ayuda {
  font-size: 12px;
  line-height: 1.4;
  color: var(--muted);
  margin: -4px 0 10px;
}

/* Bajo un campo del bloque: pegada al selector de arriba. */
.ayuda.campo {
  margin: 6px 0 14px;
}

.ayuda.campo:last-child {
  margin-bottom: 0;
}

.lista-cuentas {
  margin-top: 14px;
}

.tabla {
  min-width: 640px;
}

.tabla tr.editando td {
  background: color-mix(in srgb, var(--amarillo) 25%, var(--white));
}

.pastilla.uso {
  margin-left: 6px;
  padding: 2px 8px;
  background: color-mix(in srgb, var(--verde) 18%, var(--white));
  color: var(--verde-compra);
}

.acciones {
  white-space: nowrap;
}

.accion {
  background: var(--cream);
  border: none;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
}

.accion + .accion {
  margin-left: 6px;
}

.acciones-formulario {
  display: flex;
  gap: 10px;
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
