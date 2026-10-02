import { MetodoPago } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Tope de cordura: mas que esto en un solo pago es un dedazo. */
const MAXIMO = 1_000_000;

/**
 * Un pago a una cuenta por cobrar. Puede ser parcial: el cliente que quedo a
 * deber paga como puede, y cada pago queda con su fecha y su metodo.
 */
export class RegistrarPagoDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El monto no es válido' })
  @Min(0.01, { message: 'Un pago tiene que ser mayor que cero' })
  @Max(MAXIMO, { message: 'Ese monto no puede ser: revisa la cifra' })
  monto: number;

  /** Como pago esta vez; no tiene por que ser el metodo con que se pidio. */
  @IsEnum(MetodoPago, { message: 'Elige cómo pagó' })
  metodo: MetodoPago;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
