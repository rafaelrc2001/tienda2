import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** Un producto que no regreso del camion y cuantas unidades faltan. */
export class LineaFaltanteDto {
  @IsUUID('4', { message: 'Producto no válido' })
  productoId: string;

  @Type(() => Number)
  @IsInt({ message: 'La cantidad va en unidades enteras' })
  @Min(1, { message: 'La cantidad del faltante empieza en 1' })
  @Max(10_000, { message: 'Esa cantidad no puede ser: revisa la cifra' })
  cantidad: number;
}

/**
 * "Generar pedido x faltante": lo que el repartidor conto de menos al bajar
 * del camion. Solo cantidades: el precio lo pone la API con las listas de precio.
 */
export class GenerarFaltanteDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'No hay faltante que cobrar' })
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LineaFaltanteDto)
  lineas: LineaFaltanteDto[];
}
