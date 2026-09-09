import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CategoriaDto, CategoriasService } from './categorias.service';
import { RequiereSeccion } from '../auth/seccion.decorator';

/**
 * Administracion -> Categorias. Solo de lectura: el catalogo se alimenta de las
 * altas de producto y de las importaciones, no de un alta manual aparte.
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
}
