import { MetodoPago } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';

const recortado = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

/** Un texto opcional en blanco es lo mismo que no mandarlo. */
const opcional = ({ value }: { value: unknown }) => {
  const limpio = recortado({ value });
  return limpio === '' ? undefined : limpio;
};

/** Lo que cabe en un Decimal(12, 2), con margen para la suma de un mes. */
const TOPE = 1_000_000_000;

/** Abrir un mes de una cuenta. */
export class AbrirPeriodoDto {
  @IsInt({ message: 'El año no es válido' })
  @Min(2000, { message: 'El año no es válido' })
  @Max(2100, { message: 'El año no es válido' })
  anio: number;

  @IsInt({ message: 'El mes no es válido' })
  @Min(1, { message: 'El mes no es válido' })
  @Max(12, { message: 'El mes no es válido' })
  mes: number;

  /**
   * Solo en el primer periodo de la cuenta: los siguientes toman el saldo
   * final del anterior y aqui no se acepta otro. Puede ser negativo.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El saldo inicial lleva a lo más dos decimales' })
  @Min(-TOPE, { message: 'El saldo inicial es demasiado grande' })
  @Max(TOPE, { message: 'El saldo inicial es demasiado grande' })
  saldoInicial?: number;
}

/** Un renglon del estado de cuenta. */
export class NuevoMovimientoDto {
  /** Dia `AAAA-MM-DD`, dentro del mes del periodo. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha va como AAAA-MM-DD' })
  fecha: string;

  @IsOptional()
  @Transform(opcional)
  @IsString()
  @MaxLength(40)
  factura?: string;

  /** Con signo: lo que sale del banco va en negativo. */
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'La cantidad lleva a lo más dos decimales' })
  @NotEquals(0, { message: 'La cantidad no puede ser cero' })
  @Min(-TOPE, { message: 'La cantidad es demasiado grande' })
  @Max(TOPE, { message: 'La cantidad es demasiado grande' })
  cantidad: number;

  @IsEnum(MetodoPago, { message: 'El método de pago es Transferencia o Efectivo' })
  metodo: MetodoPago;

  @IsOptional()
  @Transform(opcional)
  @IsString()
  @MaxLength(200)
  referencia?: string;
}
