import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class GuardarNivelDto {
  @IsString()
  @MinLength(2, { message: 'El nombre del nivel es obligatorio' })
  @MaxLength(40)
  nombre: string;

  /** Gasto acumulado a partir del cual el cliente alcanza este nivel. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  umbralGasto: number;

  /** Posicion en la escalera. El nivel 1 debe tener umbral 0. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orden: number;
}
