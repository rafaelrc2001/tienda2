import { Type } from 'class-transformer';
import { IsOptional, IsPositive, IsString, Max, MaxLength } from 'class-validator';
import { EsPrecio } from '../../catalogo/dto/es-precio';
import { DECIMALES_PRECIO } from '../../catalogo/precios';

/** Tope de cordura: mas que esto por pieza es un dedazo. */
const MAXIMO = 1_000_000;

/**
 * El precio por pieza que Finanzas le pacta a un cliente en un pedido, con IVA
 * incluido como todos los precios de Rapidix. Cero no: regalar un producto no
 * es un precio, es una cortesia que no tiene donde quedar escrita.
 *
 * Admite los mismos decimales que el precio del catalogo (la columna es
 * Decimal(25, 15)): un precio pactado sale muchas veces de dividir un importe
 * entre las piezas, y redondearlo a centavos descuadraria el total de la linea.
 * `IsPositive` y no `Min(0.01)` por lo mismo: 0.005 por pieza es un precio.
 */
export class CambiarPrecioDto {
  @Type(() => Number)
  @EsPrecio({ message: `El precio admite máximo ${DECIMALES_PRECIO} decimales` })
  @IsPositive({ message: 'El precio tiene que ser mayor que cero' })
  @Max(MAXIMO, { message: 'Ese precio no puede ser: revisa la cifra' })
  precio: number;

  /** Por que se le dio otro precio: queda en la bitacora del pedido. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
