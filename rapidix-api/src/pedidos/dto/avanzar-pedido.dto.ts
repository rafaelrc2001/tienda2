import { EstadoPedido } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class AvanzarPedidoDto {
  /** Estado al que se quiere llevar el pedido. Solo vale el siguiente paso. */
  @IsEnum(EstadoPedido, { message: 'Estado de pedido no válido' })
  estado: EstadoPedido;

  /** Aclaracion que queda en la bitacora junto al paso. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
