import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CatalogoService, CategoriaConProductos, ProductoDto } from './catalogo.service';
import {
  ActualizarProductoDto,
  BuscarProductosDto,
  CrearProductoDto,
  MarcarAgotadoDto,
} from './dto/producto.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

/** Administracion -> Productos. El acceso lo decide la matriz de permisos. */
@ApiTags('Administración · Productos')
@ApiBearerAuth()
@Controller('admin/productos')
@RequiereSeccion('productos')
export class AdminProductosController {
  constructor(private readonly catalogo: CatalogoService) {}

  @Get()
  listar(@Query() filtros: BuscarProductosDto): Promise<CategoriaConProductos[]> {
    return this.catalogo.listarAgrupado(filtros);
  }

  @Post()
  crear(@Body() dto: CrearProductoDto): Promise<ProductoDto> {
    return this.catalogo.crear(dto);
  }

  @Patch(':id')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarProductoDto): Promise<ProductoDto> {
    return this.catalogo.actualizar(id, dto);
  }

  @Patch(':id/agotado')
  marcarAgotado(@Param('id') id: string, @Body() dto: MarcarAgotadoDto): Promise<ProductoDto> {
    return this.catalogo.marcarAgotado(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  eliminar(@Param('id') id: string): Promise<void> {
    return this.catalogo.eliminar(id);
  }
}
