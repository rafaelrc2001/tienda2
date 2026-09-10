import { Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { CatalogoService, CategoriaConProductos, ProductoDto } from './catalogo.service';
import { CatalogoRecomendadoDto, RecomendacionesService } from './recomendaciones.service';
import { BuscarProductosDto } from './dto/producto.dto';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { AutenticacionOpcional } from '../auth/auth-opcional.decorator';
import { UsuarioAutenticado, ROL_CLIENTE } from '../auth/jwt-payload';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

/** Tienda: lo que ve cualquier usuario autenticado. */
@ApiTags('Tienda')
@ApiBearerAuth()
@Controller()
export class CatalogoController {
  constructor(
    private readonly catalogo: CatalogoService,
    private readonly recomendaciones: RecomendacionesService,
  ) {}

  @Get('productos')
  listar(@Query() filtros: BuscarProductosDto): Promise<CategoriaConProductos[]> {
    return this.catalogo.listarAgrupado(filtros);
  }

  /**
   * El catalogo tal y como lo pinta la Tienda (HU-01 y HU-02).
   *
   * Va declarado antes que `GET productos/:id`: Nest resuelve por orden de
   * declaracion, y al reves esta ruta se leeria como un producto llamado
   * "recomendados".
   *
   * El token es opcional a proposito. Con sesion, el orden sale del historial
   * del cliente; sin ella, el visitante ve el catalogo del negocio en vez de un
   * 401 — puede mirar la tienda antes de decidir si se registra.
   */
  @Get('productos/recomendados')
  @AutenticacionOpcional()
  recomendados(
    @UsuarioActual() usuario?: UsuarioAutenticado,
  ): Promise<CatalogoRecomendadoDto> {
    // Solo el historial de un cliente ordena el catalogo: un token de staff
    // mirando la tienda no tiene pedidos suyos que consultar.
    const clienteId = usuario?.rol === ROL_CLIENTE ? usuario.sub : undefined;
    return this.recomendaciones.catalogoPara(clienteId);
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
