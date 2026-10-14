import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { AvanzarPedidoDto } from '../pedidos/dto/avanzar-pedido.dto';
import { CancelarPedidoDto } from '../pedidos/dto/cancelar-pedido.dto';
import { FinanzasService } from '../pedidos/finanzas.service';
import { FlujoPedidosService, PedidoEnPantallaDto } from '../pedidos/flujo-pedidos.service';
import { PedidosService } from '../pedidos/pedidos.service';
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
  constructor(
    private readonly pdv: PdvService,
    private readonly finanzas: FinanzasService,
    private readonly pedidos: PedidosService,
  ) {}

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

  /**
   * Cancela un pedido que el cliente ya no paso a recoger. Mismos efectos y
   * candados que la cancelacion del cliente (`FinanzasService.cancelar`): lo
   * ya cobrado lo cancela Finanzas. 404 si no se recoge en esta tienda.
   */
  @Post('tiendas/:id/operaciones/pedidos/:pedidoId/cancelar')
  @HttpCode(HttpStatus.OK)
  async cancelar(
    @Param('id') id: string,
    @Param('pedidoId', ParseUUIDPipe) pedidoId: string,
    @Body() dto: CancelarPedidoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PedidoEnPantallaDto> {
    const nota = dto.nota?.trim() || 'El cliente no pasó a recogerlo';
    await this.finanzas.cancelar(pedidoId, { tiendaId: id }, usuario, nota);
    return FlujoPedidosService.enPantalla(await this.pedidos.detalle(pedidoId));
  }
}
