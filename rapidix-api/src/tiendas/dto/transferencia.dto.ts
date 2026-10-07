import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { EstadoTransferencia } from '@prisma/client';
import { LineaMovimientoDto } from '../../inventario/dto/movimiento.dto';

/**
 * Una transferencia de bodega a una tienda.
 *
 * Se captura en la misma ventana que los movimientos y con el mismo encabezado
 * —quien mueve la mercancia y sus observaciones—, pero en lugar de motivo y
 * saldo lleva el destino: que se aparta y que sale lo decide la transferencia.
 */
export class CrearTransferenciaDto {
  @IsUUID('all', { message: 'Elige la tienda de destino' })
  tiendaId: string;

  @IsString()
  @MinLength(2, { message: 'Escribe quién movió la mercancía' })
  @MaxLength(80)
  empleado: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  observaciones?: string;

  @IsArray()
  @ArrayNotEmpty({ message: 'Captura al menos un producto con cantidad' })
  @ArrayMaxSize(200, { message: 'Una transferencia admite hasta 200 productos' })
  @ValidateNested({ each: true })
  @Type(() => LineaMovimientoDto)
  lineas: LineaMovimientoDto[];
}

export class BuscarTransferenciasDto {
  @IsOptional()
  @IsUUID()
  tiendaId?: string;

  @IsOptional()
  @IsEnum(EstadoTransferencia)
  estado?: EstadoTransferencia;
}
