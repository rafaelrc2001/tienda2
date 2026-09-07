import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { TipoDescuento } from '@prisma/client';

/**
 * Parametros editables de un tipo de ciclo de vida.
 * El `code` no se incluye a proposito: no es editable (Word 6.9).
 */
export class ActualizarCicloVidaDto {
  @IsString()
  @MinLength(1, { message: 'El título es obligatorio' })
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  customerMessage?: string;

  @IsEnum(TipoDescuento)
  discountType: TipoDescuento;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountValue: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minimumOrderAmount: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maximumOrderAmount?: number | null;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  validityDays: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  usageLimitPerCustomer: number;

  /** Solo INACTIVITY. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  inactivityDays?: number | null;

  /** Solo BIRTHDAY. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  birthdayWindowDays?: number | null;
}

export class CambiarActivoDto {
  @IsBoolean()
  isActive: boolean;
}
