import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

/** Query de GET /admin/configuracion/facturas: el mes a listar y de que razon social. */
export class MesFacturasDto {
  /** RFC del emisor, o `SIN_EMISOR` para las de antes de congelarlo. Sin el, todas. */
  @IsOptional()
  @Matches(/^([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}|SIN_EMISOR)$/, {
    message: 'emisor no es un RFC válido',
  })
  emisor?: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  anio: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  mes: number;
}
