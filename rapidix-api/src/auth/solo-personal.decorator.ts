import { SetMetadata } from '@nestjs/common';

export const SOLO_PERSONAL_KEY = 'soloPersonal';

/**
 * Cierra la ruta (o el controlador entero) a los tokens de cliente, aunque la
 * seccion la tenga tambien el cliente en la matriz.
 *
 * Existe por "mis-pedidos": es la seccion del historial del cliente en Mi
 * Perfil y a la vez la del listado de pedidos de toda la plataforma. Puesto en
 * la clase, cualquier endpoint que se le agregue nace cerrado al cliente sin
 * que nadie tenga que acordarse.
 */
export const SoloPersonal = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SOLO_PERSONAL_KEY, true);
