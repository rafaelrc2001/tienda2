import { IsBoolean } from 'class-validator';

export class CambiarCompartirDto {
  @IsBoolean()
  compartir: boolean;
}
