import { ConceptoIngreso } from '@prisma/client';
import { IsEnum, IsOptional, Matches } from 'class-validator';

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Filtros de la pestana de Ingresos. Los dias van como `AAAA-MM-DD` y son dias
 * del negocio, no instantes: que hora es "el principio del dia" lo decide la
 * API con su zona, no el navegador con la suya.
 */
export class BuscarIngresosDto {
  /** Primer dia, incluido. Sin el, el mismo que `hasta`; sin ninguno, hoy. */
  @IsOptional()
  @Matches(DIA, { message: 'La fecha inicial va como AAAA-MM-DD' })
  desde?: string;

  /** Ultimo dia, incluido. */
  @IsOptional()
  @Matches(DIA, { message: 'La fecha final va como AAAA-MM-DD' })
  hasta?: string;

  @IsOptional()
  @IsEnum(ConceptoIngreso, { message: 'Ese concepto no existe' })
  concepto?: ConceptoIngreso;
}
