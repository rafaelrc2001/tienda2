import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CategoriaDto, CategoriasService } from './categorias.service';
import { PrioridadCategoriaDto } from './dto/producto.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';

/**
 * Administracion -> Familias.
 *
 * No hay alta ni baja: el catalogo se alimenta de las altas de producto y de
 * las importaciones. Lo unico que se edita aqui es en que orden se ven las
 * familias en la Tienda, que es una decision del negocio y no se puede deducir
 * del nombre ni de cuantos productos tenga.
 */
@ApiTags('Administración · Productos')
@ApiBearerAuth()
@Controller('admin/categorias')
@RequiereSeccion('productos')
export class AdminCategoriasController {
  constructor(private readonly categorias: CategoriasService) {}

  @Get()
  listar(): Promise<CategoriaDto[]> {
    return this.categorias.listar();
  }

  @Patch(':id/prioridad')
  fijarPrioridad(
    @Param('id') id: string,
    @Body() dto: PrioridadCategoriaDto,
  ): Promise<CategoriaDto> {
    return this.categorias.fijarPrioridad(id, dto.prioridad);
  }
}
