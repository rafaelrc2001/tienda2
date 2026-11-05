import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { UsuarioPanelDto, UsuariosService } from './usuarios.service';
import { ActualizarUsuarioDto, CrearUsuarioDto } from './dto/usuario.dto';

/**
 * Configuracion -> Usuarios: el personal que entra al panel.
 *
 * Cuelga de la seccion `configuracion`, que solo tiene el Administrador. Los
 * clientes no se dan de alta aqui: entran con su WhatsApp.
 */
@ApiTags('Administración · Configuración')
@ApiBearerAuth()
@Controller('admin/configuracion/usuarios')
@RequiereSeccion('configuracion')
export class AdminUsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  listar(): Promise<UsuarioPanelDto[]> {
    return this.usuarios.listar();
  }

  /** 409 `USUARIO_DUPLICADO` si el nombre de usuario ya esta tomado. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  crear(@Body() dto: CrearUsuarioDto): Promise<UsuarioPanelDto> {
    return this.usuarios.crear(dto);
  }

  @Patch(':id')
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarUsuarioDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<UsuarioPanelDto> {
    return this.usuarios.actualizar(id, dto, usuario);
  }
}
