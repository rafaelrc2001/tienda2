import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AfectaInventario, MotivoMovimiento, TipoMovimiento } from '@prisma/client';

/** Un renglon del lote: que producto y cuanto. */
export class LineaMovimientoDto {
  @IsUUID()
  productoId: string;

  @Type(() => Number)
  @IsInt({ message: 'La cantidad debe ser un número entero' })
  @Min(1, { message: 'La cantidad debe ser mayor que cero' })
  cantidad: number;
}

/**
 * Un lote de movimientos: un solo encabezado para todos los renglones.
 *
 * Es asi porque una factura de compra con veinte productos es un solo hecho:
 * mismo empleado, mismo motivo, mismo dia. Capturar el encabezado veinte veces
 * seria la forma segura de que las veinte filas no coincidan entre si.
 */
export class RegistrarMovimientosDto {
  /**
   * Quien movio la mercancia. No tiene por que ser quien esta logueado: en
   * bodega es normal que uno capture lo que otro acaba de bajar del camion.
   */
  @IsString()
  @MinLength(2, { message: 'Escribe quién movió la mercancía' })
  @MaxLength(80)
  empleado: string;

  @IsEnum(TipoMovimiento, { message: 'El tipo debe ser ENTRADA o SALIDA' })
  tipo: TipoMovimiento;

  @IsEnum(AfectaInventario, { message: 'Indica a qué saldo afecta' })
  afecta: AfectaInventario;

  @IsEnum(MotivoMovimiento, { message: 'Elige un motivo' })
  motivo: MotivoMovimiento;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  observaciones?: string;

  @IsArray()
  @ArrayNotEmpty({ message: 'Captura al menos un producto con cantidad' })
  @ArrayMaxSize(200, { message: 'Un lote admite hasta 200 productos' })
  @ValidateNested({ each: true })
  @Type(() => LineaMovimientoDto)
  lineas: LineaMovimientoDto[];
}

/** Filtros del historial (M-11). */
export class BuscarMovimientosDto {
  @IsOptional()
  @IsUUID()
  productoId?: string;

  @IsOptional()
  @IsEnum(MotivoMovimiento)
  motivo?: MotivoMovimiento;

  /** Los ultimos 50 por defecto; nunca mas de 200 de un jalon. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limite?: number;
}
