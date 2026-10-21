import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
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
import { REGIMENES_FISCALES } from '../../facturacion/catalogos-sat';

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

  /** Solo digitos: el cliente lo copia tal cual a la app de su banco. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{15,19}$/, { message: 'El número de tarjeta debe tener entre 15 y 19 dígitos' })
  numeroTarjeta?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d{18}$/, { message: 'La CLABE debe tener 18 dígitos' })
  clabe?: string | null;
}

const recortado = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
const mayusculas = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Alta de una cuenta en Datos bancarios -> Cuentas bancarias. Los tres obligatorios. */
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
}

/**
 * Datos fiscales del negocio. Se guardan todos juntos o ninguno: un RFC sin
 * regimen no sirve para nada. La forma del RFC es la misma que la del receptor.
 */
export class FiscalDto {
  @Transform(mayusculas)
  @IsString()
  @Matches(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, {
    message: 'El RFC no es válido: son 12 caracteres (empresa) o 13 (persona física)',
  })
  rfc: string;

  /** Tal cual la constancia y sin el regimen societario, como pide el CFDI 4.0. */
  @Transform(mayusculas)
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio' })
  @MaxLength(254)
  nombre: string;

  @IsIn(REGIMENES_FISCALES.map((r) => r.clave), { message: 'Elige un régimen del catálogo' })
  regimen: string;

  @Transform(recortado)
  @Matches(/^\d{5}$/, { message: 'El CP debe tener 5 dígitos' })
  cp: string;
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
