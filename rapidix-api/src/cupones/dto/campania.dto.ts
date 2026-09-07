import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TipoAudiencia, TipoDescuento } from '@prisma/client';
import { ATRIBUTOS_SEGMENTO, AtributoSegmento, OPERADORES_SEGMENTO, OperadorSegmento } from '../segmentacion';

export class ReglaSegmentoDto {
  @IsIn(ATRIBUTOS_SEGMENTO)
  attr: AtributoSegmento;

  @IsIn(OPERADORES_SEGMENTO)
  op: OperadorSegmento;

  @IsString()
  @MinLength(1, { message: 'El valor de la regla no puede estar vacío' })
  value: string;
}

export class GuardarCampaniaDto {
  /** Nombre interno. No se repite entre campanias (Word 6.9). */
  @IsString()
  @MinLength(2, { message: 'El nombre interno es obligatorio' })
  name: string;

  @IsString()
  @MinLength(2, { message: 'El título visible para el cliente es obligatorio' })
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

  @IsOptional()
  @IsDateString({}, { message: 'La fecha de inicio no es válida' })
  startsAt?: string | null;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha de fin no es válida' })
  endsAt?: string | null;

  /** 0 = sin limite. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  usageLimitTotal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usageLimitPerCustomer?: number;

  @IsEnum(TipoAudiencia)
  targetType: TipoAudiencia;

  /** Obligatorio cuando la audiencia es SOURCE. */
  @IsOptional()
  @IsString()
  sourceCode?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReglaSegmentoDto)
  segmentRules?: ReglaSegmentoDto[];

  /** Vacio = sin restriccion de categoria (Word 4.9.3). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categorias?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
