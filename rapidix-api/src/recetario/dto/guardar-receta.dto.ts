import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CATEGORIAS_RECETA, CategoriaReceta } from './buscar-recetas.dto';

export class IngredienteDto {
  @IsString()
  @MinLength(1, { message: 'El ingrediente no puede estar vacío' })
  @MaxLength(120)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  cantidad?: string;
}

export class GuardarRecetaDto {
  @IsString()
  @MinLength(2, { message: 'El nombre de la receta es obligatorio' })
  @MaxLength(140)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  tiempo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  porciones?: number;

  @IsOptional()
  @IsString()
  imagenUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  emoji?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  youtube?: string;

  /** Word 6.4: al menos una categoria seleccionada. */
  @IsArray()
  @ArrayMinSize(1, { message: 'Elige al menos una categoría' })
  @IsIn(CATEGORIAS_RECETA, { each: true })
  categorias: CategoriaReceta[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngredienteDto)
  ingredientes?: IngredienteDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  pasos?: string[];

  /** Switch "Compartir con la comunidad". Solo aplica a recetas de cliente. */
  @IsOptional()
  @IsBoolean()
  compartir?: boolean;
}
