import { Body, Controller, ForbiddenException, Get, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CarritoGuardadoDto, ClientesService } from './clientes.service';
import { ActualizarPerfilDto, PerfilDto } from './dto/perfil.dto';
import { LineasCarritoDto } from '../pedidos/dto/carrito.dto';
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

  /**
   * Carrito a medias guardado en el servidor (HU-13).
   *
   * El navegador sigue siendo el que manda mientras la pestana esta abierta;
   * esto es la copia que hace que la compra siga ahi al entrar desde otro
   * telefono, o despues de que el navegador limpie su almacenamiento.
   */
  @Get('carrito')
  carrito(@UsuarioActual() usuario: UsuarioAutenticado): Promise<CarritoGuardadoDto> {
    return this.clientes.carritoGuardado(ClientesController.exigirCliente(usuario));
  }

  @Put('carrito')
  guardarCarrito(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: LineasCarritoDto,
  ): Promise<CarritoGuardadoDto> {
    return this.clientes.guardarCarrito(ClientesController.exigirCliente(usuario), dto.items);
  }

  private static exigirCliente(usuario: UsuarioAutenticado): string {
    if (usuario.rol !== ROL_CLIENTE) {
      throw new ForbiddenException('Esta sección es exclusiva para clientes.');
    }
    return usuario.sub;
  }
}
