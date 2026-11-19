<script setup lang="ts">
/**
 * Configuración → Datos bancarios (HU-A06).
 *
 * Solo captura: los datos que aquí se guardan son los que el cliente ve al
 * pagar por transferencia. Son dos cuentas, cada una con su tarjeta (depósito
 * en OXXO y similares) y su CLABE (SPEI):
 *  - Principal: la de quien marca «Requiero factura» en el carrito.
 *  - Secundaria: la de quien no la pide. Vacía, a ese cliente se le da la
 *    principal.
 *
 * Debajo, «Cuentas bancarias»: el directorio de cuentas del negocio (banco,
 * número y titular). Se dan de alta y se borran una a una; no cambian lo que
 * ve el cliente al transferir.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import type { Bancarios, CuentaBancaria, DatosBancariosNegocio } from '@/api/tipos'

const ui = useUiStore()

type Cual = 'principal' | 'secundaria'

/** Las dos cuentas, en el orden en que se pintan. */
const BLOQUES: { cual: Cual; titulo: string; ayuda: string }[] = [
  {
    cual: 'principal',
    titulo: 'Cuenta principal · con factura',
    ayuda: 'Se le da al cliente que marca «Requiero factura».',
  },
  {
    cual: 'secundaria',
    titulo: 'Cuenta secundaria · sin factura',
    ayuda:
      'Se le da al cliente que no pide factura. Si la dejas sin tarjeta ni CLABE, se le da la principal.',
  },
]

const CAMPOS_CUENTA = ['banco', 'numeroCuenta', 'titular'] as const

/** Se pegan con espacios o guiones desde la app del banco; la API solo acepta dígitos. */
function soloDigitos(valor: string | null): string | null {
  return valor?.replace(/\D/g, '') || null
}

function paraMandar(c: Bancarios): Bancarios {
  return {
    banco: c.banco || null,
    beneficiario: c.beneficiario || null,
    numeroCuenta: c.numeroCuenta || null,
    numeroTarjeta: soloDigitos(c.numeroTarjeta),
    clabe: soloDigitos(c.clabe),
  }
}

/**
 * Los errores del `ValidationPipe` llegan como `principal.clabe`; aquí se
 * reparten bajo el campo de su cuenta.
 */
function erroresDe(cual: Cual, campo: keyof Bancarios): string | undefined {
  return errores.value[`${cual}.${campo}`]
}

const bancarios = ref<DatosBancariosNegocio | null>(null)
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
      http.get<DatosBancariosNegocio>('/admin/configuracion/bancarios'),
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

/**
 * Las mismas reglas de la API para tarjeta y CLABE, revisadas antes de
 * mandar. Con dos cuentas, el mensaje del `ValidationPipe` llega como
 * «principal.La CLABE debe…», sin el campo: así cada error cae bajo su campo.
 */
function validar(): Record<string, string> {
  const encontrados: Record<string, string> = {}
  for (const { cual } of BLOQUES) {
    const c = paraMandar(bancarios.value![cual])
    if (c.numeroTarjeta && !/^\d{15,19}$/.test(c.numeroTarjeta)) {
      encontrados[`${cual}.numeroTarjeta`] = 'El número de tarjeta debe tener entre 15 y 19 dígitos'
    }
    if (c.clabe && !/^\d{18}$/.test(c.clabe)) {
      encontrados[`${cual}.clabe`] = 'La CLABE debe tener 18 dígitos'
    }
  }
  return encontrados
}

/** «principal.La CLABE…» → «Cuenta principal: La CLABE…». */
function legible(mensaje: string): string {
  return mensaje.replace(/^(principal|secundaria)\./, (_, cual: string) => `Cuenta ${cual}: `)
}

async function guardar(): Promise<void> {
  if (!bancarios.value) return
  errores.value = validar()
  erroresGenerales.value = []
  if (Object.keys(errores.value).length > 0) return
  guardando.value = true
  try {
    bancarios.value = await http.put<DatosBancariosNegocio>('/admin/configuracion/bancarios', {
      principal: paraMandar(bancarios.value.principal),
      secundaria: paraMandar(bancarios.value.secundaria),
    })
    ui.exito('Datos bancarios guardados')
  } catch (fallo) {
    if (fallo instanceof ErrorApi) {
      const mensajes = fallo.porCampo([]).generales
      erroresGenerales.value = (mensajes.length > 0 ? mensajes : [fallo.message]).map(legible)
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

      <!-- Las dos cuentas, cada una con su tarjeta (depósito) y su CLABE (SPEI). -->
      <section v-for="b in BLOQUES" :key="b.cual" class="cuenta-pago">
        <h2 class="titulo-seccion">{{ b.titulo }}</h2>
        <p class="ayuda">{{ b.ayuda }}</p>

        <div class="form-block">
          <label class="form-label" :for="`${b.cual}-banco`">Banco</label>
          <input :id="`${b.cual}-banco`" v-model="bancarios[b.cual].banco" class="form-input" />

          <label class="form-label" :for="`${b.cual}-beneficiario`">Beneficiario</label>
          <input
            :id="`${b.cual}-beneficiario`"
            v-model="bancarios[b.cual].beneficiario"
            class="form-input"
          />

          <label class="form-label" :for="`${b.cual}-cuenta`">Número de cuenta</label>
          <input
            :id="`${b.cual}-cuenta`"
            v-model="bancarios[b.cual].numeroCuenta"
            class="form-input"
            inputmode="numeric"
          />

          <label class="form-label" :for="`${b.cual}-tarjeta`">
            Número de tarjeta (depósito)
          </label>
          <input
            :id="`${b.cual}-tarjeta`"
            v-model="bancarios[b.cual].numeroTarjeta"
            class="form-input"
            :class="{ 'is-invalid': erroresDe(b.cual, 'numeroTarjeta') }"
            inputmode="numeric"
            maxlength="23"
          />
          <p v-if="erroresDe(b.cual, 'numeroTarjeta')" class="form-error">
            {{ erroresDe(b.cual, 'numeroTarjeta') }}
          </p>

          <label class="form-label" :for="`${b.cual}-clabe`">CLABE interbancaria (transferencia)</label>
          <input
            :id="`${b.cual}-clabe`"
            v-model="bancarios[b.cual].clabe"
            class="form-input"
            :class="{ 'is-invalid': erroresDe(b.cual, 'clabe') }"
            inputmode="numeric"
            maxlength="22"
          />
          <p v-if="erroresDe(b.cual, 'clabe')" class="form-error">
            {{ erroresDe(b.cual, 'clabe') }}
          </p>
        </div>
      </section>

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

/* La primera cuenta va pegada arriba; la segunda se separa con el aire del título. */
.cuenta-pago:first-of-type .titulo-seccion {
  margin-top: 0;
}

.ayuda {
  font-size: 12px;
  line-height: 1.4;
  color: var(--muted);
  margin: -4px 0 10px;
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
