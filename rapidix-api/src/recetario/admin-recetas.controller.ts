import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RecetaDetalle, RecetaResumen, RecetarioService } from './recetario.service';
import { BuscarRecetasDto } from './dto/buscar-recetas.dto';
import { GuardarRecetaDto } from './dto/guardar-receta.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

/** Administracion -> Recetas: solo las oficiales del Recetario (HU-A03). */
@ApiTags('Administración · Recetas')
@ApiBearerAuth()
@Controller('admin/recetas')
@RequiereSeccion('recetas')
export class AdminRecetasController {
  constructor(private readonly recetario: RecetarioService) {}

  @Get()
  listar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query() filtros: BuscarRecetasDto,
  ): Promise<RecetaResumen[]> {
    return this.recetario.listar(usuario, { ...filtros, pestana: 'recetario' });
  }

  @Post()
  publicar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: GuardarRecetaDto,
  ): Promise<RecetaDetalle> {
    return this.recetario.crearOficial(usuario, dto);
  }

  @Patch(':id')
  editar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: GuardarRecetaDto,
  ): Promise<RecetaDetalle> {
    return this.recetario.editar(id, usuario, dto, true);
  }
}
