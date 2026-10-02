import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { BuscarIngresosDto } from './dto/buscar-ingresos.dto';
import { IngresosService, ListadoIngresosDto } from './ingresos.service';

/**
 * Administracion -> Finanzas -> Ingresos: el libro de lo aceptado.
 *
 * Solo lectura, por diseño: un ingreso lo escribe quien acepta un dinero o
 * cobra un pago, dentro de esa misma transaccion. Dejar crearlo o editarlo
 * aqui seria dejar que el libro diga algo que no paso.
 */
@ApiTags('Administración · Finanzas')
@ApiBearerAuth()
@Controller('admin/finanzas/ingresos')
@RequiereSeccion('finanzas')
export class AdminIngresosController {
  constructor(private readonly ingresos: IngresosService) {}

  /**
   * Los ingresos de un rango de dias (`desde`, `hasta`, los dos incluidos y en
   * dias del negocio) y, si se pide, de un solo `concepto`. Sin fechas, hoy.
   * Trae el total del rango ya sumado.
   */
  @Get()
  listar(@Query() filtros: BuscarIngresosDto): Promise<ListadoIngresosDto> {
    return this.ingresos.listar(filtros);
  }
}
