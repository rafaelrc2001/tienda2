import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { PedidoDto, PedidosService } from './pedidos.service';
import { CrearPedidoDto } from './dto/carrito.dto';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { ROL_CLIENTE, UsuarioAutenticado } from '../auth/jwt-payload';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Pedidos')
@ApiBearerAuth()
@Controller('pedidos')
export class PedidosController {
  constructor(private readonly pedidos: PedidosService) {}

  /** Boton "Confirmar pedido" del carrito (Word 6.3). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  crear(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: CrearPedidoDto,
  ): Promise<PedidoDto> {
    if (usuario.rol !== ROL_CLIENTE) {
      throw new ForbiddenException('Solo un cliente puede confirmar pedidos.');
    }
    return this.pedidos.crear(usuario.sub, dto);
  }

  @Get('mios')
  mios(@UsuarioActual() usuario: UsuarioAutenticado): Promise<PedidoDto[]> {
    if (usuario.rol !== ROL_CLIENTE) {
      throw new ForbiddenException('Esta sección es exclusiva para clientes.');
    }
    return this.pedidos.misPedidos(usuario.sub);
  }
}
