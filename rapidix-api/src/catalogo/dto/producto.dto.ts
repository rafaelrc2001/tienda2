import { Type } from 'class-transformer';
import { RolProducto, TasaIva } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DECIMALES_PRECIO, MAX_ESCALONES } from '../precios';
import { EsPrecio } from './es-precio';

/** Formatos de las claves del SAT; la cadena vacia es «quitarla». */
const FORMATO_CLAVE_PROD_SERV = /^(\d{8})?$/;
const FORMATO_CLAVE_UNIDAD = /^([A-Za-z0-9]{1,3})?$/;

/** Una lista de precio por volumen: desde `piso` piezas, cada una a `precio`. */
export class EscalonDto {
  @Type(() => Number)
  @IsInt({ message: 'Las piezas de una lista deben ser un número entero' })
  @Min(2, { message: 'Una lista de volumen empieza en 2 piezas o más' })
  piso: number;

  @Type(() => Number)
  @EsPrecio({
    message: `El precio de una lista debe ser un número con máximo ${DECIMALES_PRECIO} decimales`,
  })
  @Min(0)
  precio: number;
}

export class CrearProductoDto {
  @IsString()
  @MinLength(2, { message: 'El nombre es obligatorio' })
  @MaxLength(120)
  nombre: string;

  @IsString()
  @MinLength(2, { message: 'La categoría es obligatoria' })
  @MaxLength(60)
  categoria: string;

  /** Word 6.6 exige nombre, categoria y precio de venta. La unidad no. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unidad?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  precioCosto?: number;

  @Type(() => Number)
  @EsPrecio({ message: 'El precio de venta es obligatorio' })
  @Min(0)
  precioVenta: number;

  @IsOptional()
  @IsString()
  imagenUrl?: string;

  @IsOptional()
  @IsBoolean()
  agotado?: boolean;

  /** Papel en su familia (HU-01). Sin decir nada, RUTINA. */
  @IsOptional()
  @IsEnum(RolProducto)
  rol?: RolProducto;

  /**
   * Listas de precio por volumen (HU-08), de menor a mayor piso. Vacio = sin
   * precio escalonado. Que los pisos suban lo comprueba el
   * servicio, que es quien conoce el precio de venta.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ESCALONES, {
    message: `Un producto admite como máximo ${MAX_ESCALONES} precios por volumen`,
  })
  @ValidateNested({ each: true })
  @Type(() => EscalonDto)
  escalones?: EscalonDto[];

  /** Si suma a la base del cashback (HU-12). Sin decir nada, si. */
  @IsOptional()
  @IsBoolean()
  aplicaCashback?: boolean;

  /** IVA con el que se factura. Sin decir nada, 0 % (alimento basico). */
  @IsOptional()
  @IsEnum(TasaIva)
  tasaIva?: TasaIva;
  /**
   * c_ClaveProdServ del SAT. Sin decir nada o vacia, el producto queda sin
   * clasificar y se factura con la generica. Que exista en el catalogo lo
   * comprueba el servicio.
   */
  @IsOptional()
  @IsString()
  @Matches(FORMATO_CLAVE_PROD_SERV, { message: 'La clave SAT del producto son 8 dígitos' })
  claveProdServ?: string;

  /** c_ClaveUnidad del SAT. Vacia = sin clasificar. */
  @IsOptional()
  @IsString()
  @Matches(FORMATO_CLAVE_UNIDAD, { message: 'La clave de unidad son hasta 3 letras o números' })
  claveUnidad?: string;
}

export class ActualizarProductoDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  categoria?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unidad?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  precioCosto?: number;

  @IsOptional()
  @Type(() => Number)
  @EsPrecio({ message: `El precio de venta admite máximo ${DECIMALES_PRECIO} decimales` })
  @Min(0)
  precioVenta?: number;

  @IsOptional()
  @IsString()
  imagenUrl?: string;

  @IsOptional()
  @IsEnum(RolProducto)
  rol?: RolProducto;

  /** Mandar `[]` quita el precio escalonado; no mandarlo lo deja como esta. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ESCALONES, {
    message: `Un producto admite como máximo ${MAX_ESCALONES} precios por volumen`,
  })
  @ValidateNested({ each: true })
  @Type(() => EscalonDto)
  escalones?: EscalonDto[];

  @IsOptional()
  @IsBoolean()
  aplicaCashback?: boolean;

  /** Cambiarla no toca lo ya vendido: cada renglon de pedido congela la suya. */
  @IsOptional()
  @IsEnum(TasaIva)
  tasaIva?: TasaIva;
  /**
   * Vacia = quitarla; no mandarla la deja como esta. A diferencia de la tasa,
   * corregirla si alcanza a los pedidos que todavia no se facturan.
   */
  @IsOptional()
  @IsString()
  @Matches(FORMATO_CLAVE_PROD_SERV, { message: 'La clave SAT del producto son 8 dígitos' })
  claveProdServ?: string;

  @IsOptional()
  @IsString()
  @Matches(FORMATO_CLAVE_UNIDAD, { message: 'La clave de unidad son hasta 3 letras o números' })
  claveUnidad?: string;
}

export class MarcarAgotadoDto {
  @IsBoolean()
  agotado: boolean;
}

/**
 * Orden de una familia en la Tienda. 1 va primero; 99 es "sin priorizar" y cae
 * al final. El tope de 99 no es decorativo: es el valor con el que nacen las
 * categorias, y dejar poner mas seria colocarlas por debajo de las que nadie
 * ha tocado.
 */
export class PrioridadCategoriaDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  prioridad: number;
}

export class BuscarProductosDto {
  /** Buscador de la Tienda: filtra por nombre (Word 4.3). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  categoria?: string;
}
