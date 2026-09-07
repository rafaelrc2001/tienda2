import { SetMetadata } from '@nestjs/common';
import { RolToken } from './jwt-payload';

export const ROLES_KEY = 'roles';

/**
 * Restringe una ruta a los roles indicados.
 * En el paso 7 esto se alimenta de la matriz `rolePermissions` del prototipo.
 */
export const Roles = (...roles: RolToken[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
