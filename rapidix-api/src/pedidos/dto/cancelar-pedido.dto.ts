import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Cancelar desde la tienda: el pedido que el cliente ya no paso a recoger. */
export class CancelarPedidoDto {
  /** Motivo, para la bitacora. Sin el queda "El cliente no paso a recogerlo". */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
