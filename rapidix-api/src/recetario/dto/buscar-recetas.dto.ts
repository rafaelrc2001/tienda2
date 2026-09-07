import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Pestanas del Recetario (Word 4.4). "historial" tiene su propio endpoint. */
export const PESTANAS = ['recetario', 'mias', 'comunidad'] as const;
export type Pestana = (typeof PESTANAS)[number];

export const CATEGORIAS_RECETA = ['desayuno', 'comida', 'cena'] as const;
export type CategoriaReceta = (typeof CATEGORIAS_RECETA)[number];

export class BuscarRecetasDto {
  @IsOptional()
  @IsIn(PESTANAS, { message: `La pestaña debe ser una de: ${PESTANAS.join(', ')}` })
  pestana?: Pestana;

  /** Ausente o "todas" = sin filtro de categoria. */
  @IsOptional()
  @IsIn([...CATEGORIAS_RECETA, 'todas'])
  categoria?: CategoriaReceta | 'todas';

  /** Busca por nombre de receta o por ingrediente (Word 4.4). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}
