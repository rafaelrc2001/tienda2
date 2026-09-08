import { RolUsuario } from '@prisma/client';

/**
 * Roles que puede tener un token. Los cinco modos de acceso del Word 2.4:
 * los cuatro de staff (RolUsuario) mas el cliente final.
 */
export const ROL_CLIENTE = 'CLIENTE' as const;

export type RolToken = RolUsuario | typeof ROL_CLIENTE;

/**
 * Con que identidad entra un token de rol CLIENTE.
 *
 * `PROSPECTO` dio su telefono y su nombre pero no ha comprado nunca: su `sub`
 * es un id de `prospectos`, no de `clientes`, y no existe todavia como cliente
 * del negocio. Al confirmar su primer pedido se convierte y el token siguiente
 * ya viene como `CLIENTE`.
 *
 * Los tokens de staff no lo llevan.
 */
export type TipoCliente = 'CLIENTE' | 'PROSPECTO';

export interface JwtPayload {
  /** Id del Usuario (staff), del Cliente o del Prospecto. */
  sub: string;
  rol: RolToken;
  /** Nombre para mostrar; evita una consulta extra en cada peticion. */
  nombre: string;
  /**
   * Solo en los tokens de rol CLIENTE: si `sub` apunta a `clientes` o a
   * `prospectos`. Los tokens viejos no lo traen, y se leen como `CLIENTE`.
   */
  tipo?: TipoCliente;
}

/**
 * Si el token es de alguien que todavia no ha comprado.
 *
 * Un token de staff nunca lo es, aunque no traiga `tipo`.
 */
export function esProspecto(payload: JwtPayload): boolean {
  return payload.rol === ROL_CLIENTE && payload.tipo === 'PROSPECTO';
}

/** Lo que queda colgado en `request.user` tras pasar por JwtAuthGuard. */
export type UsuarioAutenticado = JwtPayload;
