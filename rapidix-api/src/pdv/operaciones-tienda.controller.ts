import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { AvanzarPedidoDto } from '../pedidos/dto/avanzar-pedido.dto';
import { PedidoEnPantallaDto } from '../pedidos/flujo-pedidos.service';
import { PdvService } from './pdv.service';

/**
 * PDV -> Operaciones: los pedidos de la app que el cliente eligio recoger en
 * la tienda. Ella los prepara y los entrega; en Administracion -> Operaciones
 * no salen.
 *
 * Va bajo la seccion `pdv` y no bajo `operaciones`: los pasos son los mismos,
 * pero aqui los da quien atiende la tienda.
 */
@ApiTags('PDV')
@ApiBearerAuth()
@Controller('admin/pdv')
@RequiereSeccion('pdv')
export class OperacionesTiendaController {
  constructor(private readonly pdv: PdvService) {}

  /**
   * El aviso de la pestana: cuantos pedidos tiene cada tienda sin terminar de
   * preparar (`tiendaId` -> pedidos). De todas a la vez, para pintarlo tambien
   * en la lista donde se elige tienda.
   */
  @Get('operaciones/pendientes')
  pendientes(): Promise<Record<string, number>> {
    return this.pdv.pendientesDePreparar();
  }

  @Get('tiendas/:id/operaciones')
  porSurtir(@Param('id') id: string): Promise<PedidoEnPantallaDto[]> {
    return this.pdv.porSurtir(id);
  }

  /**
   * Da el siguiente paso. Los candados de pago responden 409 con su `code`,
   * como en Operaciones; 409 `SIN_EXISTENCIA_EN_TIENDA` al entregar lo que la
   * tienda no tiene y 404 si el pedido no se recoge en esa tienda.
   */
  @Patch('tiendas/:id/operaciones/pedidos/:pedidoId/estado')
  avanzar(
    @Param('id') id: string,
    @Param('pedidoId') pedidoId: string,
    @Body() dto: AvanzarPedidoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PedidoEnPantallaDto> {
    return this.pdv.avanzarEnTienda(id, pedidoId, dto.estado, usuario, dto.nota);
  }
}
