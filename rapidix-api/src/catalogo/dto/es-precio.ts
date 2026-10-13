import { Prisma } from '@prisma/client';
import { ValidateBy, ValidationOptions } from 'class-validator';
import { DECIMALES_PRECIO } from '../precios';

/**
 * Un precio por pieza: un numero finito con a lo mas `DECIMALES_PRECIO`
 * decimales.
 *
 * No se usa `@IsNumber({ maxDecimalPlaces })` porque cuenta los decimales
 * partiendo el texto del numero por el punto, y un numero muy chico se escribe
 * con exponente (`1e-7`): ahi no hay punto y la validacion revienta con un 500
 * en vez de contestar 400. Con tantos decimales permitidos ese caso deja de
 * ser raro. `Decimal` los cuenta bien en las dos notaciones.
 */
export function EsPrecio(opciones?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'esPrecio',
      validator: {
        validate: (valor: unknown): boolean =>
          typeof valor === 'number' &&
          Number.isFinite(valor) &&
          new Prisma.Decimal(valor).decimalPlaces() <= DECIMALES_PRECIO,
        defaultMessage: () =>
          `$property debe ser un número con máximo ${DECIMALES_PRECIO} decimales`,
      },
    },
    opciones,
  );
}
