import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Tope de cordura: mas que esto por pieza es un dedazo. */
const MAXIMO = 1_000_000;

/**
 * El precio por pieza que Finanzas le pacta a un cliente en un pedido, con IVA
 * incluido como todos los precios de Rapidix. Cero no: regalar un producto no
 * es un precio, es una cortesia que no tiene donde quedar escrita.
 */
export class CambiarPrecioDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El precio no es válido' })
  @Min(0.01, { message: 'El precio tiene que ser mayor que cero' })
  @Max(MAXIMO, { message: 'Ese precio no puede ser: revisa la cifra' })
  precio: number;

  /** Por que se le dio otro precio: queda en la bitacora del pedido. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
