import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class CalificarDto {
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'La calificación va de 1 a 5 estrellas' })
  @Max(5, { message: 'La calificación va de 1 a 5 estrellas' })
  puntuacion: number;
}
