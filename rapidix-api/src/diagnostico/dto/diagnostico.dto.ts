import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsObject,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** Un evento de la sonda: que paso y la foto de medidas en ese momento. */
export class EventoDiagnosticoDto {
  @IsString()
  @MaxLength(60)
  evento!: string;

  /** JSON libre: medidas, textos, estilos. No se valida por dentro a proposito. */
  @IsObject()
  datos!: Record<string, unknown>;
}

/**
 * Lote de eventos. La sonda los junta y los manda de golpe para no meter una
 * peticion por cada cambio del importe.
 */
export class LoteDiagnosticoDto {
  @IsString()
  @MaxLength(60)
  sesion!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => EventoDiagnosticoDto)
  eventos!: EventoDiagnosticoDto[];
}
