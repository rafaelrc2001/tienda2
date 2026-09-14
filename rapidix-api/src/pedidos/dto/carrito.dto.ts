import { Type } from 'class-transformer';
import { MetodoEntrega, MetodoPago } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class LineaCarritoDto {
  @IsString()
  productoId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'La cantidad debe ser al menos 1' })
  cantidad: number;
}

/**
 * Cuerpo de `POST /carrito/subtotal` y de `PUT /perfil/carrito`: solo lineas.
 *
 * Se admite vacio, al reves que los demas: guardar un carrito que se acaba de
 * vaciar es justamente como se borra el que estaba en el servidor, y pedir el
 * subtotal de un carrito vacio tiene una respuesta buena, que es cero.
 */
export class LineasCarritoDto {
  @IsArray()
  @ArrayMaxSize(200, { message: 'Tu carrito tiene demasiados productos' })
  @ValidateNested({ each: true })
  @Type(() => LineaCarritoDto)
  items: LineaCarritoDto[];
}

export class ValidarCuponDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{4,12}$/, { message: 'El código de cupón no es válido' })
  codigo: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Tu carrito está vacío' })
  @ValidateNested({ each: true })
  @Type(() => LineaCarritoDto)
  items: LineaCarritoDto[];
}

/** Cuerpo de POST /carrito/previsualizar: como CrearPedidoDto, sin confirmar. */
export class PrevisualizarCarritoDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Tu carrito está vacío' })
  @ValidateNested({ each: true })
  @Type(() => LineaCarritoDto)
  items: LineaCarritoDto[];

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{4,12}$/, { message: 'El código de cupón no es válido' })
  codigoCupon?: string;

  // Los tres campos del pago son opcionales aqui: el carrito se previsualiza
  // antes de que el cliente elija nada, y la respuesta dice que falta.
  @IsOptional()
  @IsEnum(MetodoPago, { message: 'El método de pago no es válido' })
  metodoPago?: MetodoPago;

  /** Efectivo: con cuanto va a pagar (HU-09). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El monto en efectivo no es válido' })
  @Min(0, { message: 'El monto en efectivo no es válido' })
  pagoCon?: number;

  /** Saldo de billetera que quiere aplicar (HU-12). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El monto de billetera no es válido' })
  @Min(0, { message: 'El monto de billetera no es válido' })
  usarBilletera?: number;

  /** Sin el, a domicilio: es como se venia pidiendo. */
  @IsOptional()
  @IsEnum(MetodoEntrega, { message: 'El método de entrega no es válido' })
  metodoEntrega?: MetodoEntrega;
}

/**
 * No hereda de PrevisualizarCarritoDto a proposito: class-validator acumula los
 * decoradores del padre, y el `@IsOptional` de `metodoPago` dejaria pasar un
 * pedido sin metodo.
 */
export class CrearPedidoDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Tu carrito está vacío' })
  @ValidateNested({ each: true })
  @Type(() => LineaCarritoDto)
  items: LineaCarritoDto[];

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{4,12}$/, { message: 'El código de cupón no es válido' })
  codigoCupon?: string;

  // Al confirmar el metodo ya no es opcional (HU-14).
  @IsEnum(MetodoPago, { message: 'Elige cómo vas a pagar' })
  metodoPago: MetodoPago;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El monto en efectivo no es válido' })
  @Min(0, { message: 'El monto en efectivo no es válido' })
  pagoCon?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El monto de billetera no es válido' })
  @Min(0, { message: 'El monto de billetera no es válido' })
  usarBilletera?: number;

  @IsOptional()
  @IsEnum(MetodoEntrega, { message: 'El método de entrega no es válido' })
  metodoEntrega?: MetodoEntrega;

  /** La casilla de aviso de privacidad y terminos (HU-14). */
  @Equals(true, { message: 'Acepta el aviso de privacidad y los términos para continuar' })
  aceptaTerminos: boolean;
}
