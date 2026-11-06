import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import { DatosFiscalesDto } from './factura.dto';

/**
 * Cuantos pedidos caben en una factura consolidada. Cada uno suma sus
 * conceptos: mas que esto ya no se lee en el PDF y el proveedor tarda.
 */
export const MAXIMO_PEDIDOS_POR_FACTURA = 50;

/** El mismo formato que acepta el login del cliente: es el mismo identificador. */
const TELEFONO = /^[+\d][\d\s\-()]{6,19}$/;

/** Un WhatsApp en blanco es «no lo guardes»: se lee como si no hubiera venido. */
const opcional = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

/** Los pedidos que se van a facturar juntos. Uno solo es la factura de siempre. */
export class PedidosAFacturarDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Elige al menos un pedido' })
  @ArrayMaxSize(MAXIMO_PEDIDOS_POR_FACTURA, {
    message: `Una factura junta como máximo ${MAXIMO_PEDIDOS_POR_FACTURA} pedidos`,
  })
  @IsUUID('all', { each: true, message: 'Alguno de los pedidos no es válido' })
  pedidoIds: string[];
}

/**
 * «Facturar» del punto de venta: los pedidos, la razon social que emite y el
 * receptor, que se captura ahi mismo aunque no este en ninguna ficha.
 */
export class FacturarPedidosPdvDto extends DatosFiscalesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Elige al menos un pedido' })
  @ArrayMaxSize(MAXIMO_PEDIDOS_POR_FACTURA, {
    message: `Una factura junta como máximo ${MAXIMO_PEDIDOS_POR_FACTURA} pedidos`,
  })
  @IsUUID('all', { each: true, message: 'Alguno de los pedidos no es válido' })
  pedidoIds: string[];

  @IsUUID('all', { message: 'Elige la razón social que emite la factura' })
  razonSocialId: string;

  /** c_FormaPago. Sin ella, la del pedido de mayor importe. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}$/, { message: 'formaPago debe ser una clave de 2 dígitos del SAT' })
  formaPago?: string;

  /**
   * WhatsApp con el que se guardan estos datos fiscales: el cliente que lo
   * tiene los recibe en su ficha, y si nadie lo tiene se da de alta para sus
   * proximas compras. Sin el, la factura sale y los datos no se guardan.
   */
  @Transform(opcional)
  @IsOptional()
  @IsString()
  @Matches(TELEFONO, { message: 'whatsapp no tiene un formato válido' })
  whatsapp?: string;
}
