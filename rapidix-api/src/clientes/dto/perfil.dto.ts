import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsISO8601,
  IsInt,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Cuerpo de PATCH /perfil.
 *
 * `telefono` no esta aqui a proposito: es la clave unica de login por OTP y
 * cambiarlo es otro flujo. Con `forbidNonWhitelisted` global, mandarlo da 400.
 */
export class ActualizarPerfilDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'El nombre es obligatorio' })
  @MaxLength(120)
  nombre?: string;

  @IsOptional()
  @IsEmail({}, { message: 'El correo no tiene un formato válido' })
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'La fecha de nacimiento debe ser una fecha válida' })
  fechaNacimiento?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  quienRecibe?: string;

  // ---- Direccion de envio ----

  @IsOptional()
  @IsString()
  @MaxLength(160)
  calle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  colonia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  cp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  ciudad?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  estado?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  referencias?: string;

  /** Fijados por el marcador arrastrable del mapa. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @IsBoolean()
  notificaciones?: boolean;
}

/** Direccion de envio tal y como la pinta la pantalla de Perfil. */
export interface DireccionDto {
  calle: string | null;
  colonia: string | null;
  cp: string | null;
  ciudad: string | null;
  estado: string | null;
  referencias: string | null;
  lat: number | null;
  lng: number | null;
}

/** Respuesta de GET /perfil y PATCH /perfil. */
export interface PerfilDto {
  id: string;
  nombre: string;
  email: string | null;
  /** Solo lectura: es la identidad de login. */
  telefono: string;
  fechaNacimiento: string | null;
  quienRecibe: string | null;
  direccion: DireccionDto;
  notificaciones: boolean;
  pedidos: number;
  totalGastado: number;
  primerPedido: string | null;
  ultimoPedido: string | null;
  creado: string;
}

/** Fila de la vista "Clientes" del panel de Administracion. */
export interface ClienteAdminDto {
  id: string;
  nombre: string;
  telefono: string;
  ciudad: string | null;
  estado: string | null;
  pedidos: number;
  totalGastado: number;
  ultimoPedido: string | null;
  creado: string;
  fuenteCodigo: string | null;
  nivel: string | null;
}

export const ORDENES_CLIENTES = ['ultimoPedido', 'totalGastado', 'pedidos', 'creado'] as const;
export type OrdenClientes = (typeof ORDENES_CLIENTES)[number];

/** Query de GET /admin/clientes: buscador, orden y paginacion. */
export class BuscarClientesDto {
  /** Busca en nombre y telefono. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsIn(ORDENES_CLIENTES, {
    message: `El orden debe ser uno de: ${ORDENES_CLIENTES.join(', ')}`,
  })
  orden?: OrdenClientes;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  porPagina?: number;
}

/** Respuesta paginada de GET /admin/clientes. */
export interface PaginaClientesDto {
  datos: ClienteAdminDto[];
  total: number;
  pagina: number;
  porPagina: number;
}
