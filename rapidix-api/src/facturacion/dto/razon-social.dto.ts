import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { REGIMENES_FISCALES } from '../catalogos-sat';

const recortado = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
const mayusculas = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toUpperCase() : value;
/** El RFC se pega a veces con espacios o guiones (`ABC-010101-XY1`): se quitan. */
const rfcLimpio = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : value;
/** Una llave en blanco es "no la cambies": se lee como si no hubiera venido. */
const llave = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

/**
 * Alta o cambio de una razon social de Configuracion -> Fiscal. La forma del
 * RFC es la misma que la del receptor.
 *
 * Las llaves de factura.com nunca se devuelven, asi que al editar llegan
 * vacias: vacio (o ausente) deja las que habia y `quitarLlaves` las borra. Las
 * tres van juntas: con una sola no se timbra.
 */
export class RazonSocialDto {
  @Transform(rfcLimpio)
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

  /** La que usan Mis pedidos, Finanzas y la factura global. */
  @IsOptional()
  @IsBoolean()
  principal?: boolean;

  /** Apagada deja de ofrecerse en el punto de venta; sus facturas siguen. */
  @IsOptional()
  @IsBoolean()
  activa?: boolean;

  @Transform(llave)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  facturaComApiKey?: string;

  @Transform(llave)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  facturaComSecretKey?: string;

  /** El id numerico de la serie, del panel de factura.com (Configuraciones > Series). */
  @Transform(llave)
  @IsOptional()
  @Matches(/^\d{1,12}$/, { message: 'La serie de factura.com es un número (su id en el panel)' })
  facturaComSerie?: string;

  @IsOptional()
  @IsBoolean()
  facturaComProduccion?: boolean;

  @IsOptional()
  @IsBoolean()
  quitarLlaves?: boolean;
}
