import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { apiAuth } from '@/api/auth'
import { CLAVE_TOKEN } from '@/api/http'
import type {
  ItemMenu,
  RespuestaSolicitarCodigo,
  RolToken,
  Seccion,
  UsuarioAutenticado,
} from '@/api/tipos'

/** Código de la fuente de adquisición, capturado del enlace `/r/CODIGO`. */
const CLAVE_FUENTE = 'rapidix.fuente'

function leer(clave: string): string | null {
  try {
    return localStorage.getItem(clave)
  } catch {
    return null
  }
}

function escribir(clave: string, valor: string | null): void {
  try {
    if (valor === null) localStorage.removeItem(clave)
    else localStorage.setItem(clave, valor)
  } catch {
    // Navegador con el almacenamiento bloqueado: la sesión dura lo que la
    // pestaña, pero la app funciona igual.
  }
}

/**
 * Sesión del usuario (SPEC 02 §3.2).
 *
 * El token se guarda en `localStorage` y se revalida contra `GET /auth/yo` al
 * arrancar: un token caducado o firmado con otro secreto no debe dejar la
 * interfaz pintada como si hubiera sesión.
 */
export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(leer(CLAVE_TOKEN))
  const usuario = ref<UsuarioAutenticado | null>(null)
  const menu = ref<ItemMenu[]>([])
  /** true mientras revalida al arrancar. */
  const cargando = ref(false)
  /** El arranque ya se resolvió, con sesión o sin ella. */
  const listo = ref(false)

  const autenticado = computed(() => token.value !== null && usuario.value !== null)
  const esCliente = computed(() => usuario.value?.rol === 'CLIENTE')
  const secciones = computed<Seccion[]>(() => menu.value.map((i) => i.seccion))

  /**
   * Si el rol del token puede entrar a una sección.
   *
   * La interfaz no lleva su propia copia de `PERMISOS_POR_ROL`: pregunta por
   * el menú que devolvió la API y se atiene a él.
   */
  function puedeVer(seccion: Seccion): boolean {
    return secciones.value.includes(seccion)
  }

  function guardarToken(nuevo: string): void {
    token.value = nuevo
    escribir(CLAVE_TOKEN, nuevo)
  }

  async function cargarMenu(): Promise<void> {
    try {
      menu.value = await apiAuth.menu()
    } catch {
      // Sin menú no se puede navegar por el panel, pero la app de cliente sí
      // funciona: se deja vacío en vez de tumbar el arranque.
      menu.value = []
    }
  }

  /** Tras cualquier login: guarda el token, lee quién es y pide su menú. */
  async function establecerSesion(accessToken: string): Promise<void> {
    guardarToken(accessToken)
    usuario.value = await apiAuth.yo()
    await cargarMenu()
  }

  /**
   * Arranque de la aplicación: revalida el token guardado.
   *
   * Mientras dura, la interfaz muestra la pantalla de carga; si falla, se
   * limpia la sesión y se cae al login.
   */
  async function arrancar(): Promise<void> {
    if (listo.value) return
    if (!token.value) {
      listo.value = true
      return
    }

    cargando.value = true
    try {
      usuario.value = await apiAuth.yo()
      await cargarMenu()
    } catch {
      cerrarSesion()
    } finally {
      cargando.value = false
      listo.value = true
    }
  }

  function cerrarSesion(): void {
    token.value = null
    usuario.value = null
    menu.value = []
    escribir(CLAVE_TOKEN, null)
  }

  // ------------------------------------------------------------------
  // Login de cliente (tres pasos) y de personal
  // ------------------------------------------------------------------

  /**
   * Paso 1. Si la API viene con `AUTH_OTP_BYPASS`, la respuesta trae el
   * código en `codigoAutomatico` y la pantalla de login entra sin pedirlo.
   */
  const solicitarCodigo = (telefono: string): Promise<RespuestaSolicitarCodigo> =>
    apiAuth.solicitarCodigo(telefono)

  /**
   * Verifica el OTP. Si la API responde `NOMBRE_REQUERIDO`, la pantalla pide
   * el nombre y vuelve a llamar aquí **con el mismo código**: la API lo deja
   * vivo a propósito.
   */
  async function verificarCodigo(datos: {
    telefono: string
    codigo: string
    nombre?: string
  }): Promise<{ esNuevo: boolean; cuponesNuevos: number }> {
    const fuenteCodigo = leer(CLAVE_FUENTE) ?? undefined
    const respuesta = await apiAuth.verificarCodigo({ ...datos, fuenteCodigo })
    await establecerSesion(respuesta.accessToken)
    // La atribución es del primer contacto: una vez usada, se descarta.
    escribir(CLAVE_FUENTE, null)
    return { esNuevo: respuesta.esNuevo, cuponesNuevos: respuesta.cuponesNuevos }
  }

  /**
   * Acceso directo por rol, sin credenciales. Solo funciona contra una API con
   * `AUTH_DEMO_LOGIN`; de la sesión para dentro es un login como cualquier otro.
   */
  async function entrarDirecto(rol: RolToken): Promise<void> {
    const respuesta = await apiAuth.entrarDirecto(rol)
    await establecerSesion(respuesta.accessToken)
  }

  async function loginStaff(email: string, password: string): Promise<void> {
    const respuesta = await apiAuth.loginStaff(email, password)
    await establecerSesion(respuesta.accessToken)
  }

  /** Guarda el código de fuente del enlace `rapidix.mx/r/CODIGO` o `?r=`. */
  function recordarFuente(codigo: string): void {
    if (codigo.trim()) escribir(CLAVE_FUENTE, codigo.trim())
  }

  return {
    token,
    usuario,
    menu,
    cargando,
    listo,
    autenticado,
    esCliente,
    secciones,
    puedeVer,
    arrancar,
    cerrarSesion,
    solicitarCodigo,
    verificarCodigo,
    entrarDirecto,
    loginStaff,
    recordarFuente,
  }
})
