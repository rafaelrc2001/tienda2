import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { NotaRutaDto } from './nota-ruta.dto';

/** "Crear entrega". El numero lo pone la API; el nombre es opcional. */
export class CrearEntregaRutaDto {
  @IsOptional()
  @IsString()
  @MaxLength(80, { message: 'El nombre de la entrega va en 80 caracteres o menos' })
  nombre?: string;
}

/**
 * "Recolectado": el pedido sube al camion **dentro de una entrega**. Se pide
 * siempre: un pedido suelto en el camion no se sabria con cual salio.
 */
export class RecolectarDto extends NotaRutaDto {
  @IsUUID('4', { message: 'Elige a qué entrega va el pedido' })
  entregaId: string;
}
