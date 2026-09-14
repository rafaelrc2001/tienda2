import { Type } from 'class-transformer';
import { MetodoEntrega, MetodoPago } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsDefined,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** Al menos un caracter que no sea espacio: "   " no es una calle. */
const CON_TEXTO = /\S/;

/**
 * Direccion de entrega de un pedido a domicilio (HU-10 y HU-11).
 *
 * Es la direccion de ESTE pedido y viaja completa desde el checkout: el backend
 * la guarda como copia en `pedidos.direccion`, no la lee del perfil. Asi el
 * cliente puede mandar a casa de un familiar sin tocar su perfil, y logistica
 * conserva la direccion aunque el perfil cambie despues.
 */
export class DireccionEntregaDto {
  @IsString()
  @Matches(CON_TEXTO, { message: 'Escribe quién recibe el pedido' })
  @MaxLength(120)
  quienRecibe: string;

  @IsString()
  @Matches(/^\d{10}$/, { message: 'El teléfono de quien recibe debe tener 10 dígitos' })
  telefono: string;

  @IsString()
  @Matches(CON_TEXTO, { message: 'Escribe la calle y el número' })
  @MaxLength(160)
  calle: string;

  @IsString()
  @Matches(CON_TEXTO, { message: 'Escribe la colonia' })
  @MaxLength(120)
  colonia: string;

  @IsString()
  @Matches(/^\d{5}$/, { message: 'El código postal debe tener 5 dígitos' })
  cp: string;

  @IsString()
  @Matches(CON_TEXTO, { message: 'Escribe la ciudad' })
  @MaxLength(80)
  ciudad: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  estado?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  referencias?: string | null;

  /** Pin del mapa. Es una ayuda: sin el, el pedido se entrega por la direccion escrita. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number | null;
}

/**
 * La misma direccion, a medio escribir, para el respaldo del borrador.
 *
 * Aqui no se exige nada: lo que se guarda es lo que el cliente lleva tecleado,
 * y un CP de tres digitos es un borrador valido. Solo se ponen topes.
 */
export class BorradorDireccionDto {
  @IsOptional() @IsString() @MaxLength(120) quienRecibe?: string;
  @IsOptional() @IsString() @MaxLength(20) telefono?: string;
  @IsOptional() @IsString() @MaxLength(160) calle?: string;
  @IsOptional() @IsString() @MaxLength(120) colonia?: string;
  @IsOptional() @IsString() @MaxLength(10) cp?: string;
  @IsOptional() @IsString() @MaxLength(80) ciudad?: string;
  @IsOptional() @IsString() @MaxLength(80) estado?: string;
  @IsOptional() @IsString() @MaxLength(400) referencias?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number | null;
}

export class BorradorEntregaDto {
  @IsOptional()
  @IsEnum(MetodoEntrega, { message: 'El método de entrega no es válido' })
  metodoEntrega?: MetodoEntrega;

  /** `null`: todavia no ha tocado la direccion y el checkout usa la del perfil. */
  @IsOptional()
  @ValidateNested()
  @Type(() => BorradorDireccionDto)
  direccion?: BorradorDireccionDto | null;
}

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

/**
 * Cuerpo de `PUT /perfil/carrito`: las lineas y, si viene, el borrador de la
 * entrega (HU-11). Sin `entrega` se conserva el borrador que hubiera.
 */
export class GuardarCarritoDto extends LineasCarritoDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BorradorEntregaDto)
  entrega?: BorradorEntregaDto;
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

  /**
   * Obligatoria a domicilio (el valor por defecto) y se ignora al recoger en
   * tienda: ahi no hay a donde entregar (HU-10).
   */
  @ValidateIf(
    (dto: CrearPedidoDto) =>
      (dto.metodoEntrega ?? MetodoEntrega.DOMICILIO) === MetodoEntrega.DOMICILIO,
  )
  @IsDefined({ message: 'Completa la dirección de entrega' })
  @ValidateNested()
  @Type(() => DireccionEntregaDto)
  direccion?: DireccionEntregaDto;

  /** La casilla de aviso de privacidad y terminos (HU-14). */
  @Equals(true, { message: 'Acepta el aviso de privacidad y los términos para continuar' })
  aceptaTerminos: boolean;
}
