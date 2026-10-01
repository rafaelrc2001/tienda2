import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Tope de cordura: mas que esto en la bolsa de un repartidor es un dedazo. */
const MAXIMO = 1_000_000;

/**
 * Lo que el repartidor **declara** que trae.
 *
 * Va aparte de lo calculado a proposito. El sistema dice una cifra y el
 * repartidor dice otra; guardar las dos es lo que permite que Finanzas vea la
 * diferencia en vez de descubrirla contando.
 *
 * Es el cuerpo de "Corregir lo que declare" y la mitad del corte: corregir
 * solo toca el dinero, la mercancia ya se conto al cerrar.
 */
export class CorregirDeclaradoDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El monto no es válido' })
  @Min(0, { message: 'El monto no puede ser negativo' })
  @Max(MAXIMO, { message: 'Ese monto no puede ser: revisa la cifra' })
  montoDeclarado: number;

  /** Novedades de la jornada. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notas?: string;
}

/** Un producto que baja del camion y cuantas piezas conto el repartidor. */
export class ProductoDevueltoDto {
  @IsUUID('4', { message: 'Producto no válido' })
  productoId: string;

  /** Cero vale: es "conte y no bajo ninguna", distinto de no haber contado. */
  @Type(() => Number)
  @IsInt({ message: 'La cantidad va en unidades enteras' })
  @Min(0, { message: 'La cantidad no puede ser negativa' })
  @Max(10_000, { message: 'Esa cantidad no puede ser: revisa la cifra' })
  cantidad: number;
}

/**
 * Cuerpo del corte: el dinero que declara y la mercancia que conto al bajar.
 *
 * `devueltos` es obligatorio aunque vaya vacio —una entrega de la que no
 * regresa nada—: lo que vuelve al fisico es lo que se conto, y un corte sin
 * conteo meteria al estante mercancia que nadie vio bajar. Que cuadre con lo
 * que el sistema dice que regresa lo comprueba `CortesService.cerrar()`.
 */
export class CerrarCorteDto extends CorregirDeclaradoDto {
  @IsArray({ message: 'Falta el conteo de lo que baja del camión' })
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ProductoDevueltoDto)
  devueltos: ProductoDevueltoDto[];
}

/** Lo que Finanzas conto al recibir el corte. */
export class RecibirCorteDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El monto no es válido' })
  @Min(0, { message: 'El monto no puede ser negativo' })
  @Max(MAXIMO, { message: 'Ese monto no puede ser: revisa la cifra' })
  montoRecibido: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notas?: string;
}

/** Lo que el repartidor entrega despues, si al recibir falto dinero. */
export class RegistrarAbonoDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El monto no es válido' })
  @Min(0.01, { message: 'Un abono tiene que ser mayor que cero' })
  @Max(MAXIMO, { message: 'Ese monto no puede ser: revisa la cifra' })
  monto: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
