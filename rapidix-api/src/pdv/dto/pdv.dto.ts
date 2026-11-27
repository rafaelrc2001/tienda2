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
import { AvanzarPedidoDto } from '../../pedidos/dto/avanzar-pedido.dto';
import { LineaCarritoDto, PrevisualizarCarritoDto } from '../../pedidos/dto/carrito.dto';

/** El mismo formato que acepta el login del cliente: es el mismo identificador. */
const TELEFONO = /^[+\d][\d\s\-()]{6,19}$/;

export class AbrirTurnoDto {
  @IsUUID('all', { message: 'Elige la tienda del turno' })
  tiendaId: string;
}

/** El PDV se mira siempre desde una tienda: su turno abierto y sus cortes. */
export class DeLaTiendaDto {
  @IsUUID('all', { message: 'Elige la tienda' })
  tiendaId: string;
}

export class BuscarClienteDto {
  @IsString()
  @Matches(TELEFONO, { message: 'El teléfono no tiene un formato válido' })
  telefono: string;
}

/**
 * Lo que el cajero lleva escrito en el visor: digitos del telefono o el nombre
 * del cliente, como el campo del login. El servicio decide cual es.
 */
export class SugerirClientesDto {
  @IsString()
  @MinLength(2, { message: 'Escribe al menos 2 letras del nombre o 3 dígitos del teléfono' })
  @MaxLength(80)
  q: string;
}

/** Quien llega al mostrador sin estar registrado: basta su telefono y su nombre. */
export class RegistrarClienteDto extends BuscarClienteDto {
  @IsString()
  @MinLength(2, { message: 'Escribe el nombre del cliente' })
  @MaxLength(80)
  nombre: string;
}

/**
 * El catalogo de la caja. Con `reemplaza` —el pedido que se esta corrigiendo—
 * lo que ese pedido llevo de la tienda cuenta como disponible.
 */
export class CatalogoPdvQueryDto extends DeLaTiendaDto {
  @IsOptional()
  @IsUUID('all', { message: 'El pedido que se corrige no es válido' })
  reemplaza?: string;
}

/** La previsualizacion del carrito de la app, mas para quien es. */
export class PrevisualizarPdvDto extends PrevisualizarCarritoDto {
  @IsUUID('all', { message: 'Identifica primero al cliente' })
  clienteId: string;

  /** El pedido que se esta corrigiendo: su mercancia y su monedero vuelven al cancelarlo. */
  @IsOptional()
  @IsUUID('all', { message: 'El pedido que se corrige no es válido' })
  reemplaza?: string;
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
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El monto de Monedero electrónico no es válido' })
  @Min(0, { message: 'El monto de Monedero electrónico no es válido' })
  usarBilletera?: number;

  /** Sin el, se lleva en mostrador: es lo normal en el punto de venta. */
  @IsOptional()
  @IsEnum(MetodoEntrega, { message: 'El método de entrega no es válido' })
  metodoEntrega?: MetodoEntrega;
}

/**
 * El paso de un pedido que se recoge en la tienda. Al entregarlo puede llevar
 * con que pago el cliente en el mostrador: al de credito lo salda entero en
 * vez de mandarlo a CXC, y al pendiente le cambia el metodo que eligio en la
 * app. Sin el, el de credito va a CXC y el pendiente se cobra con su metodo.
 */
export class AvanzarEnTiendaDto extends AvanzarPedidoDto {
  @IsOptional()
  @IsEnum(MetodoPago, { message: 'Elige cómo pagó' })
  cobro?: MetodoPago;
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
