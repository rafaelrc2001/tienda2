import { Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { CatalogoService, CategoriaConProductos, ProductoDto } from './catalogo.service';
import { BuscarProductosDto } from './dto/producto.dto';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado, ROL_CLIENTE } from '../auth/jwt-payload';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

/** Tienda: lo que ve cualquier usuario autenticado. */
@ApiTags('Tienda')
@ApiBearerAuth()
@Controller()
export class CatalogoController {
  constructor(private readonly catalogo: CatalogoService) {}

  @Get('productos')
  listar(@Query() filtros: BuscarProductosDto): Promise<CategoriaConProductos[]> {
    return this.catalogo.listarAgrupado(filtros);
  }

  @Get('categorias')
  categorias(): Promise<string[]> {
    return this.catalogo.listarCategorias();
  }

  @Get('productos/:id')
  obtener(@Param('id') id: string): Promise<ProductoDto> {
    return this.catalogo.obtener(id);
  }

  /** "Programar" un producto agotado. Solo tiene sentido para un cliente. */
  @Post('productos/:id/programar')
  programar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<{ registrado: true }> {
    if (usuario.rol !== ROL_CLIENTE) {
      throw new ForbiddenException('Solo un cliente puede programar un producto.');
    }
    return this.catalogo.programar(id, usuario.sub);
  }
}
