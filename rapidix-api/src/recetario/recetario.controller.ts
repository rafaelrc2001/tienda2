import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RecetaDetalle, RecetaResumen, RecetarioService } from './recetario.service';
import { BuscarRecetasDto } from './dto/buscar-recetas.dto';
import { GuardarRecetaDto } from './dto/guardar-receta.dto';
import { CambiarCompartirDto } from './dto/cambiar-compartir.dto';
import { BloqueoInactividadService } from './bloqueo-inactividad.service';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Recetario')
@ApiBearerAuth()
@Controller('recetas')
export class RecetarioController {
  constructor(
    private readonly recetario: RecetarioService,
    private readonly bloqueo: BloqueoInactividadService,
  ) {}

  @Get()
  listar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query() filtros: BuscarRecetasDto,
  ): Promise<RecetaResumen[]> {
    return this.recetario.listar(usuario, filtros);
  }

  /** Crear mi propia receta (HU-C06). */
  @Post()
  crear(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: GuardarRecetaDto,
  ): Promise<RecetaDetalle> {
    return this.recetario.crearPropia(usuario, dto);
  }

  /**
   * Detalle de la receta. Es el unico punto donde se comprueba el bloqueo por
   * inactividad: mirar la lista nunca bloquea (Word 5, regla 11).
   */
  @Get(':id')
  async obtener(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<RecetaDetalle> {
    await this.bloqueo.exigirAcceso(usuario);
    return this.recetario.obtener(id, usuario);
  }

  /** Editar una receta propia. */
  @Patch(':id')
  editar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: GuardarRecetaDto,
  ): Promise<RecetaDetalle> {
    return this.recetario.editar(id, usuario, dto, false);
  }

  /** Switch "Compartir con la comunidad" del menu del detalle. */
  @Patch(':id/compartir')
  compartir(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: CambiarCompartirDto,
  ): Promise<RecetaDetalle> {
    return this.recetario.cambiarCompartir(id, usuario, dto.compartir);
  }
}
