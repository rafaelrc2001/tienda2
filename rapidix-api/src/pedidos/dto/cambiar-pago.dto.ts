import { EstadoPago } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CambiarPagoDto {
  /** Estatus al que Finanzas lleva el pago. No hay orden entre ellos. */
  @IsEnum(EstadoPago, { message: 'Estatus de pago no válido' })
  estado: EstadoPago;

  /**
   * Motivo de la cancelacion o de la retencion, y cualquier aclaracion. Queda
   * en la bitacora junto al cambio; es lo unico que explica un pedido
   * cancelado meses despues.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
