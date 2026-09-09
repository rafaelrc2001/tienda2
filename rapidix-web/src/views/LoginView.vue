<script setup lang="ts">
/**
 * Login.
 *
 * Porta el flujo del mockup con dos correcciones que impone la API:
 *
 *  - Las cuatro tarjetas de staff (Administrador, Ruta, Operaciones,
 *    Finanzas) se colapsan en una, "Personal del negocio": el rol no lo elige
 *    el usuario, viaja dentro del JWT.
 *  - El cliente pasa por un OTP de 6 dígitos que el mockup no tenía.
 *
 * El paso del nombre reenvía **el mismo código**: la API deja el OTP vivo
 * cuando responde `NOMBRE_REQUERIDO`, justo para esto.
 *
 * Los dos últimos pasos van *después* de que la API haya validado, con la
 * sesión ya abierta: son la parte visible de que te reconoció por tu WhatsApp
 * (`saludo`) o de que acabas de registrarte y ya tienes cupón (`bienvenida`).
 * Ninguno de los dos pide nada a nadie; solo retrasan la entrada a la app
 * hasta que tocas el botón.
 */
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { apiAuth } from '@/api/auth'
import { ErrorApi, http } from '@/api/http'
import { dinero } from '@/utils/formato'
import type { MiCupon, RolToken } from '@/api/tipos'

type Paso = 'modo' | 'telefono' | 'codigo' | 'nombre' | 'saludo' | 'bienvenida' | 'staff'

/**
 * Las cinco tarjetas del prototipo, tal cual.
 *
 * Solo salen cuando la API viene con `AUTH_DEMO_LOGIN`: entonces tocar una
 * entra con ese rol y ya está. Es la simulación de n8n, que identificará al
 * cliente por su WhatsApp antes de abrir la app.
 */
const TARJETAS: { rol: RolToken; icono: string; titulo: string; descripcion: string }[] = [
  {
    rol: 'CLIENTE',
    icono: '🧑‍🍳',
    titulo: 'Cliente',
    descripcion: 'Pide comida, guarda recetas y acumula cashback',
  },
  {
    rol: 'ADMINISTRADOR',
    icono: '🛠️',
    titulo: 'Administrador',
    descripcion: 'Acceso completo al negocio',
  },
  { rol: 'RUTA', icono: '🛵', titulo: 'Ruta', descripcion: 'Repartidores: gestión de rutas' },
  {
    rol: 'OPERACIONES',
    icono: '🧭',
    titulo: 'Operaciones',
    descripcion: 'Seguimiento del día a día',
  },
  { rol: 'FINANZAS', icono: '💵', titulo: 'Finanzas', descripcion: 'Ingresos, gastos y clientes' },
]

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const route = useRoute()

const paso = ref<Paso>('modo')
const enviando = ref(false)
const error = ref('')

/** La API deja entrar sin credenciales. Se pregunta al abrir la pantalla. */
const accesoDirecto = ref(false)
/** Rol que se está firmando ahora mismo, para deshabilitar solo su tarjeta. */
const entrandoComo = ref<RolToken | null>(null)

const telefono = ref('')
const codigo = ref('')
const nombre = ref('')

/** Nombre con el que la API nos reconoció. Lo pinta el saludo. */
const nombreReconocido = ref('')
/**
 * Cupón de bienvenida recién ganado.
 *
 * `verificarCodigo` solo dice cuántos cupones nuevos hay, así que la tarjeta
 * se pide aparte con la sesión ya abierta. Si esa llamada falla, la pantalla
 * se enseña igual sin tarjeta: quedarse fuera de la app por no poder pintar
 * un cupón sería absurdo, y el cupón sigue estando en su pestaña.
 */
const cuponBienvenida = ref<MiCupon | null>(null)
const email = ref('')
const password = ref('')

onMounted(async () => {
  // Enlace de fuente de adquisición: `?r=CODIGO` o `/r/CODIGO`.
  const desdeQuery = route.query.r
  if (typeof desdeQuery === 'string') auth.recordarFuente(desdeQuery)

  try {
    accesoDirecto.value = (await apiAuth.modo()).demoLogin
  } catch {
    // Sin respuesta se asume la puerta cerrada: mejor pedir credenciales de
    // más que enseñar un acceso sin login que luego va a fallar.
    accesoDirecto.value = false
  }
})

/** Entra con el rol de la tarjeta, sin pedir nada. */
async function entrarDirecto(rol: RolToken): Promise<void> {
  entrandoComo.value = rol
  error.value = ''
  try {
    await auth.entrarDirecto(rol)
    await entrar()
  } catch (fallo) {
    mostrarFallo(fallo)
  } finally {
    entrandoComo.value = null
  }
}

function irA(destino: Paso): void {
  error.value = ''
  paso.value = destino
}

/** Adónde va cada rol tras entrar. El personal empieza en el panel. */
async function entrar(): Promise<void> {
  const destino = typeof route.query.destino === 'string' ? route.query.destino : null
  if (destino) {
    await router.replace(destino)
    return
  }
  await router.replace(auth.esCliente ? '/' : '/admin')
}

function mostrarFallo(fallo: unknown): void {
  error.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos completar la operación.'
}

async function enviarTelefono(): Promise<void> {
  if (!telefono.value.trim()) {
    error.value = 'Escribe tu número de WhatsApp'
    return
  }
  enviando.value = true
  error.value = ''
  try {
    const { expiraEnMinutos, codigoAutomatico } = await auth.solicitarCodigo(telefono.value.trim())

    // API con `AUTH_OTP_BYPASS`: el código viene en la respuesta y se entra de
    // largo. La pantalla de los seis dígitos ni se enseña; si el teléfono es
    // nuevo, `verificar` cae igual en el paso del nombre.
    if (codigoAutomatico) {
      codigo.value = codigoAutomatico
      await verificar()
      return
    }

    ui.info(`Te enviamos un código. Vence en ${expiraEnMinutos} minutos.`)
    codigo.value = ''
    paso.value = 'codigo'
  } catch (fallo) {
    mostrarFallo(fallo)
  } finally {
    enviando.value = false
  }
}

/**
 * Verifica el código y, si es un alta, pide el nombre sin volver a pedir el
 * código. `nombre` viaja solo cuando ya lo escribió.
 */
async function verificar(): Promise<void> {
  if (!/^\d{6}$/.test(codigo.value.trim())) {
    error.value = 'El código debe tener 6 dígitos'
    return
  }
  if (paso.value === 'nombre' && nombre.value.trim().length < 2) {
    error.value = 'Dinos cómo te llamas'
    return
  }

  enviando.value = true
  error.value = ''
  try {
    const { esNuevo, cuponesNuevos } = await auth.verificarCodigo({
      telefono: telefono.value.trim(),
      codigo: codigo.value.trim(),
      nombre: paso.value === 'nombre' ? nombre.value.trim() : undefined,
    })

    // La sesión ya está abierta. Lo que sigue es solo qué se enseña antes de
    // soltar al usuario dentro de la app.
    nombreReconocido.value = auth.usuario?.nombre ?? nombre.value.trim()

    if (esNuevo) {
      if (cuponesNuevos > 0) cuponBienvenida.value = await buscarCuponDeBienvenida()
      paso.value = 'bienvenida'
      return
    }

    paso.value = 'saludo'
  } catch (fallo) {
    // La API pide el nombre y deja el mismo código vivo: se avanza de paso
    // sin tocar `codigo`.
    if (fallo instanceof ErrorApi && fallo.codigo === 'NOMBRE_REQUERIDO') {
      paso.value = 'nombre'
      error.value = ''
      return
    }
    mostrarFallo(fallo)
  } finally {
    enviando.value = false
  }
}

/**
 * El cupón de bienvenida entre los activos del cliente.
 *
 * Se busca el WELCOME del ciclo de vida y, si no está (porque el negocio lo
 * desactivó y lo que llegó fue de una campaña), vale el primero que haya.
 */
async function buscarCuponDeBienvenida(): Promise<MiCupon | null> {
  try {
    const cupones = await http.get<MiCupon[]>('/cupones')
    return cupones.find((c) => c.sourceCode === 'WELCOME') ?? cupones[0] ?? null
  } catch {
    return null
  }
}

/** Descuento del cupón en el formato de la pestaña Cupones. */
function descuento(cupon: MiCupon): string {
  return cupon.discountType === 'PERCENTAGE'
    ? `${cupon.discountValue}%`
    : dinero(cupon.discountValue)
}

/**
 * "No soy yo": vuelve a empezar por el teléfono.
 *
 * Cierra la sesión que se acaba de abrir, porque el token ya está guardado y
 * dejarlo ahí metería en la app a la persona equivocada.
 */
function noSoyYo(): void {
  auth.cerrarSesion()
  codigo.value = ''
  nombre.value = ''
  nombreReconocido.value = ''
  cuponBienvenida.value = null
  irA('telefono')
}

async function entrarComoStaff(): Promise<void> {
  enviando.value = true
  error.value = ''
  try {
    await auth.loginStaff(email.value.trim(), password.value)
    await entrar()
  } catch (fallo) {
    mostrarFallo(fallo)
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <div class="login">
    <div class="login-logo-wrap">
      <div class="login-logo-bowl">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M4 12h16M14 8l4 4-4 4"
            stroke="#FBF3E7"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
      <div class="login-logo-text">RAPIDIX</div>
    </div>

    <!--
      Acceso directo (AUTH_DEMO_LOGIN): las cinco tarjetas del prototipo, y
      tocar una entra sin pedir nada. Simulación de n8n.
    -->
    <template v-if="paso === 'modo' && accesoDirecto">
      <div class="login-title">¿Cómo deseas ingresar?</div>
      <div class="login-subtitle">Elige el modo con el que quieres usar la app</div>

      <button
        v-for="tarjeta in TARJETAS"
        :key="tarjeta.rol"
        type="button"
        class="role-card"
        :class="{ 'client-card-highlight': tarjeta.rol === 'CLIENTE' }"
        :disabled="entrandoComo !== null"
        @click="entrarDirecto(tarjeta.rol)"
      >
        <span class="ico">{{ tarjeta.icono }}</span>
        <span class="txt">
          <span class="t">{{ tarjeta.titulo }}</span>
          <span class="s">{{ tarjeta.descripcion }}</span>
        </span>
        <span class="chev">{{ entrandoComo === tarjeta.rol ? '…' : '›' }}</span>
      </button>

      <p v-if="error" class="form-error">{{ error }}</p>

      <!--
        Las tarjetas de arriba entran sin identificar a nadie, asi que tapaban
        el login de verdad: con el acceso directo encendido no habia forma de
        llegar a escribir un telefono. Esta puerta lo devuelve.
      -->
      <div class="separador"><span>o</span></div>

      <button type="button" class="btn-secondary ancho" @click="irA('telefono')">
        Entrar con mi WhatsApp
      </button>

      <p class="login-aviso">Modo de pruebas: las tarjetas entran sin contraseña.</p>
    </template>

    <!-- Paso 1: cómo entras -->
    <template v-else-if="paso === 'modo'">
      <div class="login-title">¿Cómo deseas ingresar?</div>
      <div class="login-subtitle">Elige el modo con el que quieres usar la app</div>

      <button type="button" class="role-card client-card-highlight" @click="irA('telefono')">
        <span class="ico">🧑‍🍳</span>
        <span class="txt">
          <span class="t">Cliente</span>
          <span class="s">Pide comida, guarda recetas y acumula cashback</span>
        </span>
        <span class="chev">›</span>
      </button>

      <!--
        Las cuatro tarjetas de staff del mockup se colapsan aquí: el rol lo
        decide el token, no quien entra.
      -->
      <button type="button" class="role-card" @click="irA('staff')">
        <span class="ico">🛠️</span>
        <span class="txt">
          <span class="t">Personal del negocio</span>
          <span class="s">Administración, rutas, operaciones y finanzas</span>
        </span>
        <span class="chev">›</span>
      </button>
    </template>

    <!-- Paso 2 del cliente: teléfono -->
    <form v-else-if="paso === 'telefono'" @submit.prevent="enviarTelefono">
      <button type="button" class="login-back" @click="irA('modo')">← Elegir otro modo</button>
      <div class="login-step-title">Ingresa con tu WhatsApp</div>
      <div class="login-step-sub">
        Usamos tu número para identificarte y mostrarte tus datos guardados.
      </div>

      <label class="form-label" for="telefono">Número de WhatsApp</label>
      <input
        id="telefono"
        v-model="telefono"
        class="form-input"
        :class="{ 'is-invalid': error }"
        type="tel"
        inputmode="tel"
        autocomplete="tel"
        placeholder="Ej. 9211234567"
      />
      <p v-if="error" class="form-error">{{ error }}</p>

      <button type="submit" class="btn-primary ancho" :disabled="enviando">
        {{ enviando ? 'Enviando…' : 'Continuar' }}
      </button>
    </form>

    <!-- Paso 3 del cliente: código de 6 dígitos -->
    <form v-else-if="paso === 'codigo'" @submit.prevent="verificar">
      <button type="button" class="login-back" @click="irA('telefono')">← Cambiar número</button>
      <div class="login-step-title">Escribe tu código</div>
      <div class="login-step-sub">
        Te mandamos un código de 6 dígitos a <strong>{{ telefono }}</strong
        >.
      </div>

      <label class="form-label" for="codigo">Código de verificación</label>
      <input
        id="codigo"
        v-model="codigo"
        class="form-input campo-codigo"
        :class="{ 'is-invalid': error }"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="6"
        placeholder="000000"
      />
      <p v-if="error" class="form-error">{{ error }}</p>

      <button type="submit" class="btn-primary ancho" :disabled="enviando">
        {{ enviando ? 'Verificando…' : 'Entrar' }}
      </button>
      <button type="button" class="login-reenviar" :disabled="enviando" @click="enviarTelefono">
        No me llegó, enviar otro código
      </button>
    </form>

    <!-- Paso 4 del cliente: alta. Reenvía el mismo código. -->
    <form v-else-if="paso === 'nombre'" @submit.prevent="verificar">
      <button type="button" class="login-back" @click="irA('telefono')">← Cambiar número</button>
      <div class="login-step-title">¡Eres nuevo por aquí!</div>
      <div class="login-step-sub">
        No encontramos ese número. Dinos tu nombre para darte la bienvenida.
      </div>

      <label class="form-label" for="nombre">¿Cómo te llamas?</label>
      <input
        id="nombre"
        v-model="nombre"
        class="form-input"
        :class="{ 'is-invalid': error }"
        autocomplete="name"
        placeholder="Tu nombre completo"
      />
      <p v-if="error" class="form-error">{{ error }}</p>

      <button type="submit" class="btn-primary ancho" :disabled="enviando">
        {{ enviando ? 'Creando tu cuenta…' : 'Continuar' }}
      </button>
    </form>

    <!--
      Te reconocimos: el saludo que pidió el negocio. La sesión ya está
      abierta; esto solo lo hace visible antes de entrar.
    -->
    <template v-else-if="paso === 'saludo'">
      <div class="saludo-emoji">👋</div>
      <div class="saludo-titulo">¡Hola de nuevo, {{ nombreReconocido }}!</div>
      <p class="saludo-sub">
        Te reconocimos por tu WhatsApp
        <strong>{{ telefono }}</strong>
      </p>

      <button type="button" class="btn-primary ancho" @click="entrar">Entrar</button>
      <button type="button" class="login-reenviar" @click="noSoyYo">
        ¿No eres tú? Cambiar número
      </button>
    </template>

    <!-- Alta recién hecha: se le enseña el cupón que acaba de ganar. -->
    <template v-else-if="paso === 'bienvenida'">
      <div class="saludo-emoji">🎉</div>
      <div class="saludo-titulo">¡Bienvenido a Rapidix, {{ nombreReconocido }}!</div>
      <p class="saludo-sub">Tu cuenta quedó lista.</p>

      <div v-if="cuponBienvenida" class="cupon-regalo">
        <span class="valor">{{ descuento(cuponBienvenida) }}</span>
        <span class="titulo">{{ cuponBienvenida.title }}</span>
        <span class="codigo">{{ cuponBienvenida.code }}</span>
        <span class="pie">Úsalo en tu primer pedido</span>
      </div>

      <button type="button" class="btn-primary ancho" @click="entrar">
        {{ cuponBienvenida ? 'Empezar a pedir' : 'Entrar' }}
      </button>
    </template>

    <!-- Personal del negocio: email y contraseña -->
    <form v-else @submit.prevent="entrarComoStaff">
      <button type="button" class="login-back" @click="irA('modo')">← Elegir otro modo</button>
      <div class="login-step-title">Personal del negocio</div>
      <div class="login-step-sub">Entra con el correo y la contraseña de tu cuenta.</div>

      <label class="form-label" for="email">Correo</label>
      <input
        id="email"
        v-model="email"
        class="form-input"
        type="email"
        autocomplete="username"
        placeholder="tu@rapidix.mx"
      />

      <label class="form-label" for="password">Contraseña</label>
      <input
        id="password"
        v-model="password"
        class="form-input"
        :class="{ 'is-invalid': error }"
        type="password"
        autocomplete="current-password"
        placeholder="••••••••"
      />
      <p v-if="error" class="form-error">{{ error }}</p>

      <button type="submit" class="btn-primary ancho" :disabled="enviando">
        {{ enviando ? 'Entrando…' : 'Entrar' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
/* Separa las tarjetas de prueba del login real, para que no se confundan. */
.separador {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 0 14px;
  color: var(--muted);
  font-size: 11.5px;
}

.separador::before,
.separador::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line);
}

.saludo-emoji {
  font-size: 46px;
  text-align: center;
  margin-bottom: 10px;
}

.saludo-titulo {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 19px;
  color: var(--ink);
  text-align: center;
  margin-bottom: 8px;
}

.saludo-sub {
  font-size: 12.5px;
  color: var(--muted);
  text-align: center;
  line-height: 1.6;
  margin-bottom: 24px;
}

/* La tarjeta del cupón: el regalo es el importe, así que manda en tamaño. */
.cupon-regalo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: linear-gradient(135deg, #fff6ea, #fdecd2);
  border: 1.5px dashed var(--terracotta);
  border-radius: 16px;
  padding: 20px 16px;
  margin-bottom: 22px;
}

.cupon-regalo .valor {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 34px;
  color: var(--terracotta);
  line-height: 1.1;
}

.cupon-regalo .titulo {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13.5px;
  color: var(--ink);
  text-align: center;
}

.cupon-regalo .codigo {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.16em;
  color: var(--terracotta-dark);
  background: var(--white);
  border-radius: 8px;
  padding: 5px 12px;
  margin-top: 6px;
}

.cupon-regalo .pie {
  font-size: 11px;
  color: var(--muted);
  margin-top: 4px;
}

.login {
  min-height: 100dvh;
  background: var(--cream);
  padding: 34px 24px;
  overflow-y: auto;
}

.login-logo-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 28px;
}

.login-logo-bowl {
  width: 66px;
  height: 44px;
  background: var(--terracotta);
  border-radius: 0 0 34px 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}

.login-logo-bowl svg {
  width: 30px;
  height: 30px;
}

.login-logo-text {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 21px;
  color: var(--terracotta);
  letter-spacing: 0.03em;
}

.login-title {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 17px;
  color: var(--ink);
  text-align: center;
  margin-bottom: 6px;
}

.login-subtitle {
  font-size: 12.5px;
  color: var(--muted);
  text-align: center;
  margin-bottom: 22px;
}

.role-card {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  text-align: left;
  background: var(--white);
  border: 1.5px solid var(--line);
  border-radius: 16px;
  padding: 14px 16px;
  margin-bottom: 12px;
  cursor: pointer;
  box-shadow: var(--shadow);
  font-family: inherit;
}

.role-card .ico {
  font-size: 26px;
  width: 44px;
  height: 44px;
  background: var(--cream-2);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.role-card .txt {
  flex: 1;
  min-width: 0;
}

.role-card .t {
  display: block;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 14px;
  color: var(--ink);
}

.role-card .s {
  display: block;
  font-size: 11px;
  color: var(--muted);
  margin-top: 2px;
}

.role-card .chev {
  font-size: 18px;
  color: var(--muted);
  flex-shrink: 0;
}

.role-card.client-card-highlight {
  border-color: var(--terracotta);
  background: linear-gradient(135deg, #fff6ea, #fdecd2);
}

.role-card:disabled {
  opacity: 0.55;
  cursor: default;
}

.login-aviso {
  font-size: 11px;
  color: var(--muted);
  text-align: center;
  margin-top: 14px;
}

.login-back {
  background: none;
  border: none;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  cursor: pointer;
  padding: 0;
  margin-bottom: 16px;
  text-align: left;
  display: block;
}

.login-step-title {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 16px;
  color: var(--ink);
  margin-bottom: 6px;
}

.login-step-sub {
  font-size: 12.5px;
  color: var(--muted);
  margin-bottom: 18px;
  line-height: 1.5;
}

.ancho {
  width: 100%;
  margin-top: 6px;
}

.campo-codigo {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 22px;
  letter-spacing: 0.4em;
  text-align: center;
}

.login-reenviar {
  display: block;
  width: 100%;
  background: none;
  border: none;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  cursor: pointer;
  padding: 14px 4px 0;
}
</style>
