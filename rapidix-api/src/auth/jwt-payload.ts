import { RolUsuario } from '@prisma/client';

/**
 * Roles que puede tener un token. Los cinco modos de acceso del Word 2.4:
 * los cuatro de staff (RolUsuario) mas el cliente final.
 */
export const ROL_CLIENTE = 'CLIENTE' as const;

export type RolToken = RolUsuario | typeof ROL_CLIENTE;

export interface JwtPayload {
  /** Id del Usuario (staff) o del Cliente. */
  sub: string;
  rol: RolToken;
  /** Nombre para mostrar; evita una consulta extra en cada peticion. */
  nombre: string;
}

/** Lo que queda colgado en `request.user` tras pasar por JwtAuthGuard. */
export type UsuarioAutenticado = JwtPayload;
