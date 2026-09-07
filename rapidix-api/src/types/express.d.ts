import { UsuarioAutenticado } from '../auth/jwt-payload';

declare global {
  namespace Express {
    interface Request {
      /** Lo deja JwtAuthGuard tras verificar el token. */
      user?: UsuarioAutenticado;
    }
  }
}

export {};
