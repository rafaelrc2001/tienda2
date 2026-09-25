import { Type } from 'class-transformer';
import { MotivoDevolucion } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Lo que el cliente acepto de un renglon del camion.
 *
 * Se manda la cantidad aceptada y no la devuelta: es lo que el repartidor
 * cuenta delante del cliente, y lo que se cobra. Lo devuelto es la resta.
 */
export class RenglonEntregadoDto {
  @IsUUID()
  pedidoItemId: string;

  /** Entre cero y lo que subio al camion; el tope lo comprueba el servicio. */
  @Type(() => Number)
  @IsInt({ message: 'La cantidad entregada debe ser un número entero' })
  @Min(0, { message: 'La cantidad entregada no puede ser negativa' })
  cantidadEntregada: number;

  /** Obligatorio en cuanto sobre una sola pieza; prohibido si se entrego todo. */
  @IsOptional()
  @IsEnum(MotivoDevolucion, { message: 'Ese motivo de devolución no existe' })
  motivoDevolucion?: MotivoDevolucion;
}

/**
 * Cuerpo de "Entregado": lo que acepto el cliente, renglon por renglon, y la
 * evidencia de la entrega.
 *
 * La evidencia es opcional y no frena la entrega: la foto puede fallar y el
 * cliente puede negar el permiso de ubicacion. Las imagenes se suben antes a
 * la carpeta `entregas` y aqui viajan solo sus ids.
 */
export class EntregarPedidoDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Di qué se entregó de cada renglón' })
  @ValidateNested({ each: true })
  @Type(() => RenglonEntregadoDto)
  items: RenglonEntregadoDto[];

  @IsOptional()
  @IsUUID()
  fotoId?: string;

  @IsOptional()
  @IsUUID()
  firmaId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;

  /**
   * El efectivo que el cliente le dio en la puerta. Si viene y no cubre el
   * cobro, la entrega no se cierra: el faltante acabaria saliendo en el corte.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El pago recibido lleva a lo más dos decimales' })
  @Min(0, { message: 'El pago recibido no puede ser negativo' })
  pagoRecibido?: number;
}

/**
 * Lo que cuenta el repartidor mientras cuenta, sin cerrar nada.
 *
 * Mas tolerante que la entrega: faltan renglones o sobran piezas a media
 * captura, y aqui eso se lee como cero o como el tope en vez de un 400.
 */
export class RenglonPrevistoDto {
  @IsUUID()
  pedidoItemId: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  cantidadEntregada: number;
}

export class PrevisualizarEntregaDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RenglonPrevistoDto)
  items: RenglonPrevistoDto[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  pagoRecibido?: number;
}

/**
 * Cuerpo de "No entregado": el intento que no llego a entrega.
 *
 * El motivo es uno solo para el pedido entero —no se entrego nada, asi que no
 * hay nada que distinguir renglon por renglon— y es obligatorio: de estos
 * motivos salen los reportes de devolucion.
 */
export class NoEntregadoDto {
  @IsEnum(MotivoDevolucion, { message: 'Di por qué no se pudo entregar' })
  motivo: MotivoDevolucion;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
