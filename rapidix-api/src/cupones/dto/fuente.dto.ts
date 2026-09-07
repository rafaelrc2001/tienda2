import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { TipoFuente } from '@prisma/client';

export class GuardarFuenteDto {
  @IsString()
  @MinLength(2, { message: 'El nombre es obligatorio' })
  @MaxLength(80)
  name: string;

  /**
   * Codigo corto del enlace rapidix.mx/r/CODIGO. Solo letras y digitos:
   * va en una URL y se dicta de viva voz.
   */
  @IsString()
  @Matches(/^[A-Za-z0-9]{2,20}$/, {
    message: 'El código debe tener entre 2 y 20 letras o números, sin espacios ni símbolos',
  })
  code: string;

  @IsOptional()
  @IsEnum(TipoFuente)
  type?: TipoFuente;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
