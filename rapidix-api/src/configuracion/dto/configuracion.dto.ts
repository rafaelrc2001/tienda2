import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
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

  /**
   * Cuantas veces vale el cashback al ir a la billetera (x2). Ya no es un
   * porcentaje: el % sale del nivel del cliente (HU-12 y HU-16).
   */
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

/**
 * Datos bancarios (HU-A06): que cuentas del directorio se dan al cliente que
 * transfiere. La principal a quien pide factura; la secundaria a quien no.
 * `null` deja la casilla sin cuenta.
 */
export class BancariosDto {
  @IsOptional()
  @IsUUID('all', { message: 'Elige una cuenta del directorio' })
  cuentaPrincipalId?: string | null;

  @IsOptional()
  @IsUUID('all', { message: 'Elige una cuenta del directorio' })
  cuentaSecundariaId?: string | null;
}

const recortado = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

/**
 * Tarjeta y CLABE se pegan con espacios o guiones desde la app del banco: se
 * quedan solo los digitos, y vacias valen `null` (son opcionales).
 */
const soloDigitosONulo = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  return value.replace(/\D/g, '') || null;
};

/**
 * Alta o edicion de una cuenta del directorio. Banco, numero y titular son
 * obligatorios (los pide Finanzas -> Bancos); tarjeta y CLABE solo hacen
 * falta si la cuenta se le da al cliente para transferir.
 */
export class CuentaBancariaDto {
  @Transform(recortado)
  @IsString()
  @MinLength(1, { message: 'El banco es obligatorio' })
  @MaxLength(80)
  banco: string;

  /** Solo digitos, como en los datos de pago: es lo que se teclea en la app del banco. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\D/g, '') : value,
  )
  @IsString()
  @Matches(/^\d{6,20}$/, { message: 'El número de cuenta debe tener entre 6 y 20 dígitos' })
  numeroCuenta: string;

  @Transform(recortado)
  @IsString()
  @MinLength(1, { message: 'El titular es obligatorio' })
  @MaxLength(120)
  titular: string;

  /** Solo digitos: el cliente lo copia tal cual a la app de su banco. */
  @Transform(soloDigitosONulo)
  @IsOptional()
  @IsString()
  @Matches(/^\d{15,19}$/, { message: 'El número de tarjeta debe tener entre 15 y 19 dígitos' })
  numeroTarjeta?: string | null;

  @Transform(soloDigitosONulo)
  @IsOptional()
  @IsString()
  @Matches(/^\d{18}$/, { message: 'La CLABE debe tener 18 dígitos' })
  clabe?: string | null;
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
