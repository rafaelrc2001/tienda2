import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Solo hay dos sitios donde el negocio sube imagenes: productos y recetas. */
export const CARPETAS = ['productos', 'recetas'] as const;
export type Carpeta = (typeof CARPETAS)[number];

/** Formatos aceptados. Se valida el tipo declarado y se fija en el objeto. */
export const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type TipoImagen = (typeof TIPOS_PERMITIDOS)[number];

export const TAMANO_MAXIMO_BYTES = 5 * 1024 * 1024;

export class FirmarSubidaDto {
  @IsIn(CARPETAS, { message: `La carpeta debe ser una de: ${CARPETAS.join(', ')}` })
  carpeta: Carpeta;

  @IsIn(TIPOS_PERMITIDOS, {
    message: `Formato no permitido. Usa: ${TIPOS_PERMITIDOS.join(', ')}`,
  })
  contentType: TipoImagen;

  /** Tamano declarado, para rechazar antes de gastar la subida. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TAMANO_MAXIMO_BYTES, { message: 'La imagen no puede pesar más de 5 MB' })
  tamanoBytes?: number;
}
