import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Los pasos de Rutas no eligen destino —cada boton es uno solo— asi que lo
 * unico que viaja es la aclaracion que queda en la bitacora.
 */
export class NotaRutaDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
