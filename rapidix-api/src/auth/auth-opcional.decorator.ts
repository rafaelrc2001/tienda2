import { SetMetadata } from '@nestjs/common';

export const AUTH_OPCIONAL_KEY = 'authOpcional';

/**
 * Ruta que se puede pedir con token y sin el.
 *
 * No es lo mismo que `@Public()`: una ruta publica no mira el token siquiera,
 * y esta si —cuando viene, y viene valido, el handler recibe su
 * `@UsuarioActual()`; cuando no, recibe `undefined` y responde igual—. Es lo
 * que necesita el catalogo de la Tienda (HU-02): quien no ha entrado ve el
 * orden fijo del negocio, y quien si, el suyo.
 *
 * Un token roto o caducado se ignora en silencio: la alternativa seria dejar
 * sin tienda a quien tiene una sesion vieja en el navegador.
 */
export const AutenticacionOpcional = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUTH_OPCIONAL_KEY, true);
