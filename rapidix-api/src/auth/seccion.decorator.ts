import { SetMetadata } from '@nestjs/common';
import { Seccion } from './permisos';

export const SECCION_KEY = 'seccion';

/**
 * Ata una ruta a una seccion del panel. Quien puede entrar sale de la matriz
 * PERMISOS_POR_ROL, no de una lista repetida en cada controlador: cambiar la
 * matriz cambia el acceso en toda la API.
 */
export const RequiereSeccion = (seccion: Seccion): MethodDecorator & ClassDecorator =>
  SetMetadata(SECCION_KEY, seccion);
