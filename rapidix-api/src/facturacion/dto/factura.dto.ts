import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { REGIMENES_FISCALES, USOS_CFDI } from '../catalogos-sat';

const mayusculas = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const recortado = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

/**
 * Los datos del receptor del CFDI 4.0, como vienen en la Constancia de
 * Situacion Fiscal. Se validan aqui la forma; que existan y coincidan con el
 * SAT solo lo sabe el proveedor al timbrar.
 */
export class DatosFiscalesDto {
  /** 12 caracteres persona moral, 13 persona fisica. */
  @Transform(mayusculas)
  @IsString()
  @Matches(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, {
    message: 'rfc no es válido: son 12 caracteres (empresa) o 13 (persona física)',
  })
  rfc: string;

  /**
   * Tal cual la constancia y, si es empresa, sin el regimen societario (sin
   * «S.A. de C.V.»): asi lo pide el CFDI 4.0.
   */
  @Transform(mayusculas)
  @IsString()
  @MinLength(1, { message: 'razonSocial es obligatoria' })
  @MaxLength(254)
  razonSocial: string;

  @IsIn(REGIMENES_FISCALES.map((r) => r.clave), { message: 'regimenFiscal no está en el catálogo' })
  regimenFiscal: string;

  @IsIn(USOS_CFDI.map((u) => u.clave), { message: 'usoCfdi no está en el catálogo' })
  usoCfdi: string;

  /** El CP del domicilio fiscal, no el de entrega. */
  @Transform(recortado)
  @Matches(/^\d{5}$/, { message: 'cpFiscal debe tener 5 dígitos' })
  cpFiscal: string;

  /**
   * A donde el proveedor manda el PDF y el XML. Obligatorio: factura.com no da
   * de alta al receptor sin correo.
   */
  @Transform(recortado)
  @IsEmail({}, { message: 'email es obligatorio y tiene que ser un correo válido' })
  email: string;
}

export class FacturarPedidoDto extends DatosFiscalesDto {
  /** «Guardar estos datos para mis próximas facturas». */
  @IsOptional()
  @IsBoolean()
  guardarDatos?: boolean;

  /**
   * c_FormaPago que eligio el cliente. Sin ella, la del pedido
   * (`formaDePago` de `comprobante.ts`). Que este en el catalogo lo
   * comprueba el servicio.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}$/, { message: 'formaPago debe ser una clave de 2 dígitos del SAT' })
  formaPago?: string;
}
