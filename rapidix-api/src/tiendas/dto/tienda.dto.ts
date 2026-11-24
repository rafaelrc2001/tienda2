import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Las horas de un dia. Si cierra antes de abrir, cruza la medianoche. */
export class HorasDelDiaDto {
  @Matches(HORA, { message: 'La hora de apertura debe tener formato HH:MM' })
  abre: string;

  @Matches(HORA, { message: 'La hora de cierre debe tener formato HH:MM' })
  cierra: string;
}

/** Un dia en `null` (o sin mandar) es que ese dia no abre. */
export class HorarioTiendaDto {
  @IsOptional() @ValidateNested() @Type(() => HorasDelDiaDto) lun?: HorasDelDiaDto | null;
  @IsOptional() @ValidateNested() @Type(() => HorasDelDiaDto) mar?: HorasDelDiaDto | null;
  @IsOptional() @ValidateNested() @Type(() => HorasDelDiaDto) mie?: HorasDelDiaDto | null;
  @IsOptional() @ValidateNested() @Type(() => HorasDelDiaDto) jue?: HorasDelDiaDto | null;
  @IsOptional() @ValidateNested() @Type(() => HorasDelDiaDto) vie?: HorasDelDiaDto | null;
  @IsOptional() @ValidateNested() @Type(() => HorasDelDiaDto) sab?: HorasDelDiaDto | null;
  @IsOptional() @ValidateNested() @Type(() => HorasDelDiaDto) dom?: HorasDelDiaDto | null;
}

/** Alta y edicion de una tienda (Configuracion -> Tiendas). */
export class GuardarTiendaDto {
  @IsString()
  @MinLength(2, { message: 'El nombre de la tienda es obligatorio' })
  @MaxLength(80)
  nombre: string;

  @IsString()
  @MinLength(2, { message: 'La dirección es obligatoria' })
  @MaxLength(200)
  direccion: string;

  /** Texto libre: no tiene por que ser un usuario del panel. */
  @IsString()
  @MinLength(2, { message: 'Escribe quién es la persona responsable' })
  @MaxLength(80)
  responsable: string;

  /** Una tienda no se borra: se apaga, y deja de ofrecerse como destino. */
  @IsOptional()
  @IsBoolean()
  activa?: boolean;

  /**
   * RFC con el que factura por defecto: una de las cuentas de factura.com del
   * servidor (Configuracion -> Fiscal). Null = la principal. Si deja de estar
   * configurado, se factura con la principal.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, { message: 'emisorRfc no es un RFC válido' })
  emisorRfc?: string | null;

  /**
   * Horario dia por dia. Informativo: no bloquea pedidos; fuera de el el
   * carrito avisa que el pedido queda para la siguiente apertura. `null` lo
   * borra; sin mandar, se deja el que tenia.
   */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HorarioTiendaDto)
  horario?: HorarioTiendaDto | null;
}
