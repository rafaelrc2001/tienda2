import { RolUsuario } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Recorta y pasa a minusculas: el usuario se compara siempre asi. */
const normalizarUsuario = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Vacio llega como "" desde el formulario; se lee como "sin tienda". */
const vacioANull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

/**
 * Campos comunes al alta y a la edicion (Configuracion -> Usuarios).
 *
 * La tienda es obligatoria solo para PDV: su punto de venta no le ofrece
 * otra. Al resto del personal se le puede poner, pero no cambia nada.
 */
class CamposUsuarioDto {
  @Transform(recortar)
  @IsString()
  @MinLength(2, { message: 'El nombre es obligatorio' })
  @MaxLength(80)
  nombre: string;

  @Transform(recortar)
  @IsString()
  @MinLength(2, { message: 'Los apellidos son obligatorios' })
  @MaxLength(120)
  apellidos: string;

  /** Solo la fecha, `AAAA-MM-DD`. */
  @IsDateString({ strict: true }, { message: 'La fecha de ingreso es obligatoria' })
  fechaIngreso: string;

  @Transform(normalizarUsuario)
  @IsString()
  @MinLength(3, { message: 'El usuario debe tener al menos 3 caracteres' })
  @MaxLength(60)
  @Matches(/^[a-z0-9._@-]+$/, {
    message: 'El usuario solo puede llevar letras, números, punto, guion, guion bajo y @',
  })
  usuario: string;

  @IsIn(Object.values(RolUsuario), { message: 'Elige un rol' })
  rol: RolUsuario;

  @Transform(vacioANull)
  @ValidateIf((o: CamposUsuarioDto) => o.rol === RolUsuario.PDV || o.tiendaId != null)
  @IsString({ message: 'Un usuario de PDV necesita una tienda asignada' })
  tiendaId?: string | null;
}

export class CrearUsuarioDto extends CamposUsuarioDto {
  /** Corta a proposito: el negocio la quiere sencilla. */
  @IsString()
  @MinLength(3, { message: 'La contraseña debe tener al menos 3 caracteres' })
  @MaxLength(100)
  password: string;
}

export class ActualizarUsuarioDto extends CamposUsuarioDto {
  /** Vacia o ausente: se conserva la que tenia. */
  @Transform(vacioANull)
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'La contraseña debe tener al menos 3 caracteres' })
  @MaxLength(100)
  password?: string | null;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
