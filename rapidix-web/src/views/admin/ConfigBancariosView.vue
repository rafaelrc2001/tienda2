<script setup lang="ts">
/**
 * Configuración → Datos bancarios (HU-A06).
 *
 * Solo captura: los datos que aquí se guardan son los que el cliente ve al
 * confirmar un pedido por transferencia.
 *
 * Debajo, «Cuentas bancarias»: el directorio de cuentas del negocio (banco,
 * número y titular). Se dan de alta y se borran una a una; no cambian lo que
 * ve el cliente al transferir.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import type { Bancarios, CuentaBancaria } from '@/api/tipos'

const ui = useUiStore()

const CAMPOS = ['banco', 'beneficiario', 'numeroCuenta', 'numeroTarjeta', 'clabe'] as const
const CAMPOS_CUENTA = ['banco', 'numeroCuenta', 'titular'] as const

/** Se pegan con espacios o guiones desde la app del banco; la API solo acepta dígitos. */
function soloDigitos(valor: string | null): string | null {
  return valor?.replace(/\D/g, '') || null
}

const bancarios = ref<Bancarios | null>(null)
const cargando = ref(true)
const guardando = ref(false)
const errores = ref<Record<string, string>>({})
const erroresGenerales = ref<string[]>([])

const cuentas = ref<CuentaBancaria[]>([])
const nuevaCuenta = ref({ banco: '', numeroCuenta: '', titular: '' })
const agregando = ref(false)
const erroresCuenta = ref<Record<string, string>>({})
const erroresCuentaGenerales = ref<string[]>([])

onMounted(async () => {
  try {
    ;[bancarios.value, cuentas.value] = await Promise.all([
      http.get<Bancarios>('/admin/configuracion/bancarios'),
      http.get<CuentaBancaria[]>('/admin/configuracion/cuentas-bancarias'),
    ])
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
})

async function agregarCuenta(): Promise<void> {
  agregando.value = true
  erroresCuenta.value = {}
  erroresCuentaGenerales.value = []
  try {
    const cuenta = await http.post<CuentaBancaria>('/admin/configuracion/cuentas-bancarias', {
      banco: nuevaCuenta.value.banco.trim(),
      numeroCuenta: nuevaCuenta.value.numeroCuenta.replace(/\D/g, ''),
      titular: nuevaCuenta.value.titular.trim(),
    })
    cuentas.value.push(cuenta)
    nuevaCuenta.value = { banco: '', numeroCuenta: '', titular: '' }
    ui.exito('Cuenta bancaria agregada')
  } catch (fallo) {
    if (fallo instanceof ErrorApi) {
      const { campos, generales } = fallo.porCampo(CAMPOS_CUENTA)
      erroresCuenta.value = campos
      erroresCuentaGenerales.value = generales.length > 0 ? generales : [fallo.message]
    } else {
      ui.errorDeApi(fallo)
    }
  } finally {
    agregando.value = false
  }
}

async function eliminarCuenta(cuenta: CuentaBancaria): Promise<void> {
  if (!confirm(`¿Eliminar la cuenta ${cuenta.numeroCuenta} de ${cuenta.banco}?`)) return
  try {
    await http.delete(`/admin/configuracion/cuentas-bancarias/${cuenta.id}`)
    cuentas.value = cuentas.value.filter((c) => c.id !== cuenta.id)
    ui.exito('Cuenta bancaria eliminada')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  }
}

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

      <h2 class="titulo-seccion">Cuentas bancarias</h2>

      <p v-for="(mensaje, i) in erroresCuentaGenerales" :key="i" class="form-error">
        {{ mensaje }}
      </p>

      <div class="form-block">
        <label class="form-label" for="cb-banco">Banco</label>
        <input
          id="cb-banco"
          v-model="nuevaCuenta.banco"
          class="form-input"
          :class="{ 'is-invalid': erroresCuenta.banco }"
          maxlength="80"
          placeholder="Ej. BBVA"
        />
        <p v-if="erroresCuenta.banco" class="form-error">{{ erroresCuenta.banco }}</p>

        <label class="form-label" for="cb-cuenta">Número de cuenta</label>
        <input
          id="cb-cuenta"
          v-model="nuevaCuenta.numeroCuenta"
          class="form-input"
          :class="{ 'is-invalid': erroresCuenta.numeroCuenta }"
          inputmode="numeric"
          maxlength="26"
        />
        <p v-if="erroresCuenta.numeroCuenta" class="form-error">
          {{ erroresCuenta.numeroCuenta }}
        </p>

        <label class="form-label" for="cb-titular">Titular</label>
        <input
          id="cb-titular"
          v-model="nuevaCuenta.titular"
          class="form-input"
          :class="{ 'is-invalid': erroresCuenta.titular }"
          maxlength="120"
          placeholder="Nombre de quien es la cuenta"
        />
        <p v-if="erroresCuenta.titular" class="form-error">{{ erroresCuenta.titular }}</p>
      </div>

      <button type="button" class="btn-primary ancho" :disabled="agregando" @click="agregarCuenta">
        {{ agregando ? 'Agregando…' : '+ Dar de alta cuenta bancaria' }}
      </button>

      <div v-if="cuentas.length > 0" class="tabla-envoltorio lista-cuentas">
        <table class="tabla">
          <thead>
            <tr>
              <th>Banco</th>
              <th>Número de cuenta</th>
              <th>Titular</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="cuenta in cuentas" :key="cuenta.id">
              <td>
                <span class="folio">{{ cuenta.banco }}</span>
              </td>
              <td>{{ cuenta.numeroCuenta }}</td>
              <td>{{ cuenta.titular }}</td>
              <td class="num">
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
}

.lista-cuentas {
  margin-top: 14px;
}

.tabla {
  min-width: 420px;
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
