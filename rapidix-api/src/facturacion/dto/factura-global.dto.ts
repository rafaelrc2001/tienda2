import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MESES_SAT, PERIODICIDADES } from '../factura-global';

const opcional = ({ value }: { value: unknown }) => {
  const limpio = typeof value === 'string' ? value.trim() : value;
  return limpio === '' ? undefined : limpio;
};

/** Un renglon de la tabla del modal: el producto y cuantas piezas. El precio lo pone la API. */
export class RenglonFacturaGlobalDto {
  @IsString()
  @IsNotEmpty({ message: 'Elige un producto' })
  productoId: string;

  /** Piezas enteras: la factura global no lleva cantidades a granel. */
  @IsInt({ message: 'La cantidad tiene que ser un número entero' })
  @Min(1, { message: 'La cantidad tiene que ser mayor que cero' })
  @Max(1_000_000, { message: 'La cantidad es demasiado grande' })
  cantidad: number;
}

/** `POST .../factura-global/previsualizar`: con esto la API reparte el total. */
export class PrevisualizarFacturaGlobalDto {
  /** Los depositos palomeados. Su suma es el total de la factura. */
  @IsArray()
  @ArrayMinSize(1, { message: 'Selecciona al menos un movimiento' })
  @ArrayMaxSize(500)
  @IsString({ each: true })
  movimientoIds: string[];

  /**
   * Vacio en la vista previa es valido: solo devuelve la suma de los
   * depositos, que es lo que Bancos pinta debajo de la tabla al palomear.
   */
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RenglonFacturaGlobalDto)
  renglones: RenglonFacturaGlobalDto[];
}

/** `POST .../factura-global`: lo de la vista previa mas lo que se elige del CFDI. */
export class TimbrarFacturaGlobalDto extends PrevisualizarFacturaGlobalDto {
  // Se suma a las reglas heredadas: para timbrar hace falta al menos uno.
  @ArrayMinSize(1, { message: 'Agrega al menos un producto' })
  declare renglones: RenglonFacturaGlobalDto[];

  /** c_FormaPago. Llega propuesta con la del deposito de mayor monto. */
  @IsString()
  @Matches(/^\d{2}$/, { message: 'Elige la forma de pago' })
  formaPago: string;

  @IsIn(PERIODICIDADES.map((p) => p.clave), { message: 'Elige la periodicidad' })
  periodicidad: string;

  @IsIn(MESES_SAT.map((m) => m.clave), { message: 'Elige el mes' })
  meses: string;

  @IsInt({ message: 'El año no es válido' })
  @Min(2000, { message: 'El año no es válido' })
  @Max(2100, { message: 'El año no es válido' })
  anio: number;

  /** Opcional: a donde el proveedor manda el PDF y el XML. */
  @IsOptional()
  @Transform(opcional)
  @IsEmail({}, { message: 'El correo no es válido' })
  email?: string;
}
