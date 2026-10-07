import { Type } from 'class-transformer';
import { MetodoEntrega, MetodoPago } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { LineaCarritoDto, PrevisualizarCarritoDto } from '../../pedidos/dto/carrito.dto';

/** El mismo formato que acepta el login del cliente: es el mismo identificador. */
const TELEFONO = /^[+\d][\d\s\-()]{6,19}$/;

export class AbrirTurnoDto {
  @IsUUID('all', { message: 'Elige la tienda del turno' })
  tiendaId: string;
}

export class BuscarClienteDto {
  @IsString()
  @Matches(TELEFONO, { message: 'El teléfono no tiene un formato válido' })
  telefono: string;
}

/** Quien llega al mostrador sin estar registrado: basta su telefono y su nombre. */
export class RegistrarClienteDto extends BuscarClienteDto {
  @IsString()
  @MinLength(2, { message: 'Escribe el nombre del cliente' })
  @MaxLength(80)
  nombre: string;
}

/** La previsualizacion del carrito de la app, mas para quien es. */
export class PrevisualizarPdvDto extends PrevisualizarCarritoDto {
  @IsUUID('all', { message: 'Identifica primero al cliente' })
  clienteId: string;
}

/**
 * "Confirmar pedido" del punto de venta.
 *
 * Como el checkout de la app, sin precios. No lleva direccion —a domicilio se
 * usa la del perfil del cliente— ni casilla de terminos: lo captura el cajero.
 */
export class CrearPedidoPdvDto {
  @IsUUID('all', { message: 'Identifica primero al cliente' })
  clienteId: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'La orden está vacía' })
  @ValidateNested({ each: true })
  @Type(() => LineaCarritoDto)
  items: LineaCarritoDto[];

  @IsEnum(MetodoPago, { message: 'Elige cómo va a pagar' })
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

  /** Sin el, se lleva en mostrador: es lo normal en el punto de venta. */
  @IsOptional()
  @IsEnum(MetodoEntrega, { message: 'El método de entrega no es válido' })
  metodoEntrega?: MetodoEntrega;
}

export class CorteDeCajaDto {
  /** El efectivo que el cajero conto al cerrar. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Escribe el efectivo contado' })
  @Min(0, { message: 'El efectivo contado no puede ser negativo' })
  efectivoDeclarado: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notas?: string;
}
