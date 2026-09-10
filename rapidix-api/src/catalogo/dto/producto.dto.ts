import { Type } from 'class-transformer';
import { RolProducto } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CrearProductoDto {
  @IsString()
  @MinLength(2, { message: 'El nombre es obligatorio' })
  @MaxLength(120)
  nombre: string;

  @IsString()
  @MinLength(2, { message: 'La categoría es obligatoria' })
  @MaxLength(60)
  categoria: string;

  /** Word 6.6 exige nombre, categoria y precio de venta. La unidad no. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unidad?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  precioCosto?: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El precio de venta es obligatorio' })
  @Min(0)
  precioVenta: number;

  @IsOptional()
  @IsString()
  imagenUrl?: string;

  @IsOptional()
  @IsBoolean()
  agotado?: boolean;

  /** Papel en su familia (HU-01). Sin decir nada, RUTINA. */
  @IsOptional()
  @IsEnum(RolProducto)
  rol?: RolProducto;
}

export class ActualizarProductoDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  categoria?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unidad?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  precioCosto?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  precioVenta?: number;

  @IsOptional()
  @IsString()
  imagenUrl?: string;

  @IsOptional()
  @IsEnum(RolProducto)
  rol?: RolProducto;
}

export class MarcarAgotadoDto {
  @IsBoolean()
  agotado: boolean;
}

/**
 * Orden de una familia en la Tienda. 1 va primero; 99 es "sin priorizar" y cae
 * al final. El tope de 99 no es decorativo: es el valor con el que nacen las
 * categorias, y dejar poner mas seria colocarlas por debajo de las que nadie
 * ha tocado.
 */
export class PrioridadCategoriaDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  prioridad: number;
}

export class BuscarProductosDto {
  /** Buscador de la Tienda: filtra por nombre (Word 4.3). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  categoria?: string;
}
