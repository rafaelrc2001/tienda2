import { Body, Controller, ForbiddenException, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientesService } from './clientes.service';
import { ActualizarPerfilDto, PerfilDto } from './dto/perfil.dto';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { ROL_CLIENTE, UsuarioAutenticado } from '../auth/jwt-payload';

/**
 * Pantalla "Mi Perfil" del cliente (Word 4.7).
 *
 * No corresponde a ninguna seccion del panel, asi que no lleva
 * @RequiereSeccion: se comprueba el rol a mano, como en Cashback.
 */
@ApiTags('Perfil')
@ApiBearerAuth()
@Controller('perfil')
export class ClientesController {
  constructor(private readonly clientes: ClientesService) {}

  @Get()
  perfil(@UsuarioActual() usuario: UsuarioAutenticado): Promise<PerfilDto> {
    return this.clientes.perfil(ClientesController.exigirCliente(usuario));
  }

  /** Datos personales, quien recibe y direccion con `lat`/`lng` del mapa. */
  @Patch()
  actualizar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() cambios: ActualizarPerfilDto,
  ): Promise<PerfilDto> {
    return this.clientes.actualizar(ClientesController.exigirCliente(usuario), cambios);
  }

  private static exigirCliente(usuario: UsuarioAutenticado): string {
    if (usuario.rol !== ROL_CLIENTE) {
      throw new ForbiddenException('Esta sección es exclusiva para clientes.');
    }
    return usuario.sub;
  }
}
