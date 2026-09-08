import { http } from './http'
import type {
  ItemMenu,
  ModoAcceso,
  RespuestaSolicitarCodigo,
  RespuestaToken,
  RespuestaVerificarCodigo,
  RolToken,
  UsuarioAutenticado,
} from './tipos'

/**
 * Endpoints de sesión.
 *
 * Los tres de login pasan `sinCierreDeSesion`: un 401 ahí significa
 * credenciales incorrectas, no una sesión caducada, y no debe disparar el
 * cierre global.
 */
export const apiAuth = {
  /** Si esta API deja entrar sin credenciales. Lo consulta el login al abrirse. */
  modo: (): Promise<ModoAcceso> => http.get('/auth/modo', { sinCierreDeSesion: true }),

  /** Acceso directo por rol. Solo responde con `AUTH_DEMO_LOGIN` encendido. */
  entrarDirecto: (rol: RolToken): Promise<RespuestaToken> =>
    http.post('/auth/demo/entrar', { rol }, { sinCierreDeSesion: true }),

  solicitarCodigo: (telefono: string): Promise<RespuestaSolicitarCodigo> =>
    http.post('/auth/cliente/solicitar-codigo', { telefono }, { sinCierreDeSesion: true }),

  verificarCodigo: (datos: {
    telefono: string
    codigo: string
    nombre?: string
    fuenteCodigo?: string
  }): Promise<RespuestaVerificarCodigo> =>
    http.post('/auth/cliente/verificar-codigo', datos, { sinCierreDeSesion: true }),

  loginStaff: (email: string, password: string): Promise<RespuestaToken> =>
    http.post('/auth/staff/login', { email, password }, { sinCierreDeSesion: true }),

  yo: (): Promise<UsuarioAutenticado> => http.get('/auth/yo'),

  menu: (): Promise<ItemMenu[]> => http.get('/admin/menu'),
}
