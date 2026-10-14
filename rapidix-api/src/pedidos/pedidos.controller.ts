import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { PedidoDto, PedidosService, UltimoPedidoDto } from './pedidos.service';
import { FinanzasService } from './finanzas.service';
import { CrearPedidoDto } from './dto/carrito.dto';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { ROL_CLIENTE, UsuarioAutenticado } from '../auth/jwt-payload';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Pedidos')
@ApiBearerAuth()
@Controller('pedidos')
export class PedidosController {
  constructor(
    private readonly pedidos: PedidosService,
    private readonly finanzas: FinanzasService,
  ) {}

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

  /**
   * Boton "Cancelar" de Mis Pedidos: el cliente se arrepiente antes de que el
   * pedido salga de bodega. Deshace lo mismo que la cancelacion de Finanzas
   * (inventario, billetera, cashback). 409 con su `code` si ya no se puede
   * (MERCANCIA_FUERA, PAGO_RECIBIDO...) y 404 si el pedido no es suyo.
   */
  @Post(':id/cancelar')
  @HttpCode(HttpStatus.OK)
  async cancelar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PedidoDto> {
    if (usuario.rol !== ROL_CLIENTE) {
      throw new ForbiddenException('Esta sección es exclusiva para clientes.');
    }
    await this.finanzas.cancelar(
      id,
      { clienteId: usuario.sub },
      usuario,
      'Cancelado por el cliente',
    );
    return this.pedidos.detalle(id);
  }

  /**
   * Bloque "repetir mi ultima compra" de la Tienda (HU-04).
   *
   * Responde 200 con `null` cuando el cliente todavia no ha comprado: no es un
   * 404, es que ese bloque no aplica todavia.
   */
  @Get('ultimo')
  ultimo(@UsuarioActual() usuario: UsuarioAutenticado): Promise<UltimoPedidoDto | null> {
    if (usuario.rol !== ROL_CLIENTE) {
      throw new ForbiddenException('Esta sección es exclusiva para clientes.');
    }
    return this.pedidos.ultimoPedido(usuario.sub);
  }
}
