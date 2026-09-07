import { RolUsuario } from '@prisma/client';
import { ROL_CLIENTE, RolToken } from './jwt-payload';

/**
 * Secciones del panel de Administracion.
 * Portado de `adminMenuItemsCatalog` del prototipo.
 */
export const SECCIONES = [
  'productos',
  'recetas',
  'configuracion',
  'operaciones',
  'rutas',
  'finanzas',
  'mis-pedidos',
  'mis-cupones',
  'clientes',
] as const;

export type Seccion = (typeof SECCIONES)[number];

/**
 * Que ve cada rol. Portado literalmente de `rolePermissions` del prototipo,
 * que a su vez implementa la tabla del Word 2.4.
 *
 * El cliente solo tiene "mis-pedidos" dentro de Mi Perfil: sus Cupones viven
 * en la barra inferior de la app, no en el panel de Administracion.
 */
export const PERMISOS_POR_ROL: Readonly<Record<RolToken, readonly Seccion[]>> = {
  [RolUsuario.ADMINISTRADOR]: [
    'productos',
    'recetas',
    'configuracion',
    'operaciones',
    'rutas',
    'finanzas',
    'mis-pedidos',
    'clientes',
  ],
  [ROL_CLIENTE]: ['mis-pedidos'],
  [RolUsuario.RUTA]: ['rutas'],
  [RolUsuario.OPERACIONES]: ['operaciones'],
  [RolUsuario.FINANZAS]: ['finanzas', 'clientes'],
};

/** Roles que pueden entrar a una seccion. */
export function rolesConAcceso(seccion: Seccion): RolToken[] {
  return (Object.keys(PERMISOS_POR_ROL) as RolToken[]).filter((rol) =>
    PERMISOS_POR_ROL[rol].includes(seccion),
  );
}

export function tieneAcceso(rol: RolToken, seccion: Seccion): boolean {
  return PERMISOS_POR_ROL[rol]?.includes(seccion) ?? false;
}
