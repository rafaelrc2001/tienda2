import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Tope de cordura: mas que esto en la bolsa de un repartidor es un dedazo. */
const MAXIMO = 1_000_000;

/**
 * Cuerpo del corte: lo que el repartidor **declara** que trae.
 *
 * Va aparte de lo calculado a proposito. El sistema dice una cifra y el
 * repartidor dice otra; guardar las dos es lo que permite que Finanzas vea la
 * diferencia en vez de descubrirla contando.
 */
export class CerrarCorteDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El monto no es válido' })
  @Min(0, { message: 'El monto no puede ser negativo' })
  @Max(MAXIMO, { message: 'Ese monto no puede ser: revisa la cifra' })
  montoDeclarado: number;

  /** Novedades de la jornada. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notas?: string;
}

/** Lo que Finanzas conto al recibir el corte. */
export class RecibirCorteDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El monto no es válido' })
  @Min(0, { message: 'El monto no puede ser negativo' })
  @Max(MAXIMO, { message: 'Ese monto no puede ser: revisa la cifra' })
  montoRecibido: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notas?: string;
}

/** Lo que el repartidor entrega despues, si al recibir falto dinero. */
export class RegistrarAbonoDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El monto no es válido' })
  @Min(0.01, { message: 'Un abono tiene que ser mayor que cero' })
  @Max(MAXIMO, { message: 'Ese monto no puede ser: revisa la cifra' })
  monto: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
