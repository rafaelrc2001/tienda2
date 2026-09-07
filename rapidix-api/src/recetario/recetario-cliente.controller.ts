import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import {
  EntradaHistorial,
  RecetaPausadaDto,
  RecetarioClienteService,
} from './recetario-cliente.service';
import { CalificarDto } from './dto/calificar.dto';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

/** Estado del Recetario que pertenece a un cliente concreto. */
@ApiTags('Recetario')
@ApiBearerAuth()
@Controller()
export class RecetarioClienteController {
  constructor(private readonly clienteRecetario: RecetarioClienteService) {}

  // ---- Mis Recetas ----

  @Post('recetas/:id/guardar')
  @HttpCode(HttpStatus.OK)
  guardar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<{ guardada: true }> {
    return this.clienteRecetario.guardar(id, usuario);
  }

  @Delete('recetas/:id/guardar')
  quitarGuardada(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<{ guardada: false }> {
    return this.clienteRecetario.quitarGuardada(id, usuario);
  }

  // ---- Receta en pausa ----

  @Get('recetario/pausada')
  verPausada(@UsuarioActual() usuario: UsuarioAutenticado): Promise<RecetaPausadaDto | null> {
    return this.clienteRecetario.verPausada(usuario);
  }

  @Put('recetas/:id/pausar')
  @HttpCode(HttpStatus.OK)
  pausar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<RecetaPausadaDto> {
    return this.clienteRecetario.pausar(id, usuario);
  }

  /** "Continuar receta" o "Cancelar receta". */
  @Delete('recetario/pausada')
  quitarPausa(@UsuarioActual() usuario: UsuarioAutenticado): Promise<{ pausada: null }> {
    return this.clienteRecetario.quitarPausa(usuario);
  }

  // ---- "!Listo a comer!" y calificacion ----

  @Post('recetas/:id/cocinada')
  @HttpCode(HttpStatus.OK)
  marcarCocinada(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<{ cocinadaEn: string; puedeCalificar: true }> {
    return this.clienteRecetario.marcarCocinada(id, usuario);
  }

  @Post('recetas/:id/calificar')
  @HttpCode(HttpStatus.OK)
  calificar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: CalificarDto,
  ): Promise<{ puntuacion: number }> {
    return this.clienteRecetario.calificar(id, usuario, dto.puntuacion);
  }

  // ---- Historial ----

  @Get('recetario/historial')
  historial(@UsuarioActual() usuario: UsuarioAutenticado): Promise<EntradaHistorial[]> {
    return this.clienteRecetario.historial(usuario);
  }
}
