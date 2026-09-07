import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class LineaCarritoDto {
  @IsString()
  productoId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'La cantidad debe ser al menos 1' })
  cantidad: number;
}

export class ValidarCuponDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{4,12}$/, { message: 'El código de cupón no es válido' })
  codigo: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Tu carrito está vacío' })
  @ValidateNested({ each: true })
  @Type(() => LineaCarritoDto)
  items: LineaCarritoDto[];
}

/** Cuerpo de POST /carrito/previsualizar: como CrearPedidoDto, sin confirmar. */
export class PrevisualizarCarritoDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Tu carrito está vacío' })
  @ValidateNested({ each: true })
  @Type(() => LineaCarritoDto)
  items: LineaCarritoDto[];

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{4,12}$/, { message: 'El código de cupón no es válido' })
  codigoCupon?: string;
}

export class CrearPedidoDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Tu carrito está vacío' })
  @ValidateNested({ each: true })
  @Type(() => LineaCarritoDto)
  items: LineaCarritoDto[];

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{4,12}$/, { message: 'El código de cupón no es válido' })
  codigoCupon?: string;
}
