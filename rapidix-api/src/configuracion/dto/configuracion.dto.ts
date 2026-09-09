import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class DiasServicioDto {
  @IsBoolean() lun: boolean;
  @IsBoolean() mar: boolean;
  @IsBoolean() mie: boolean;
  @IsBoolean() jue: boolean;
  @IsBoolean() vie: boolean;
  @IsBoolean() sab: boolean;
  @IsBoolean() dom: boolean;
}

/** Word 6.8 recomienda validar formato de hora y telefono. Aqui se hace. */
export class HorarioDto {
  @IsObject()
  @ValidateNested()
  @Type(() => DiasServicioDto)
  diasServicio: DiasServicioDto;

  @Matches(HORA, { message: 'La hora de apertura debe tener formato HH:MM' })
  abre: string;

  @Matches(HORA, { message: 'La hora de cierre debe tener formato HH:MM' })
  cierra: string;

  @IsBoolean()
  atenderFuera: boolean;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  incrementoFuera: number;

  @IsOptional()
  @IsString()
  @Matches(/^[+\d][\d\s\-()]{6,19}$/, {
    message: 'El WhatsApp de ayuda no tiene un formato válido',
  })
  whatsappAyuda?: string | null;
}

export class ParametrosDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  costoEnvio: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  montoEnvioGratis: number;

  /** Porcentaje de cashback sobre el subtotal. Ver "Riesgos" del SPEC 01. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  multiplicadorCashback: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  montoMinimoCashback: number;

  /**
   * Si un pedido descuenta existencias de la bodega.
   *
   * Opcional para que los clientes viejos de la API que no lo mandan no
   * apaguen sin querer un control que ya estaba encendido.
   */
  @IsOptional()
  @IsBoolean()
  controlInventario?: boolean;
}

export class BancariosDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  banco?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  beneficiario?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  numeroCuenta?: string | null;
}

export class NoticiaDto {
  @IsString()
  @MinLength(1, { message: 'El título es obligatorio' })
  @MaxLength(120)
  titulo: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  badge?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  desc?: string;
}

export class AvisoDto {
  @IsString()
  @MinLength(1, { message: 'El título es obligatorio' })
  @MaxLength(120)
  titulo: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  desc?: string;
}
