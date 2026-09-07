import { http } from './http'
import type {
  ItemMenu,
  RespuestaToken,
  RespuestaVerificarCodigo,
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
  solicitarCodigo: (telefono: string): Promise<{ enviado: true; expiraEnMinutos: number }> =>
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
