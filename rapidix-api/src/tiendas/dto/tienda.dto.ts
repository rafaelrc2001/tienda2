import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
}
