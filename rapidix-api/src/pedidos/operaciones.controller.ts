import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  FiltroOperaciones,
  FlujoPedidosService,
  ListadoOperacionesDto,
  PedidoEnPantallaDto,
} from './flujo-pedidos.service';
import { AvanzarPedidoDto } from './dto/avanzar-pedido.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { SoloPersonal } from '../auth/solo-personal.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';

/**
 * Administracion -> Operaciones: surtir los pedidos y dejarlos listos para
 * entrega, o entregarlos en mostrador si se recogen en tienda.
 */
@ApiTags('Administración · Operaciones')
@ApiBearerAuth()
@Controller('admin/operaciones')
@RequiereSeccion('operaciones')
@SoloPersonal()
export class OperacionesController {
  constructor(private readonly flujo: FlujoPedidosService) {}

  @Get('pedidos')
  listar(
    @Query(
      'filtro',
      new DefaultValuePipe(FiltroOperaciones.ACTIVOS),
      new ParseEnumPipe(FiltroOperaciones),
    )
    filtro: FiltroOperaciones,
    @Query('limite', new ParseIntPipe({ optional: true })) limite?: number,
  ): Promise<ListadoOperacionesDto> {
    return this.flujo.listarOperaciones(filtro, Math.min(limite ?? 100, 500));
  }

  /**
   * Da el siguiente paso. Los candados de pago responden 409 con su `code`
   * (PAGO_RETENIDO, PAGO_NO_LIBERADO, PEDIDO_CANCELADO...).
   */
  @Patch('pedidos/:id/estado')
  avanzar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AvanzarPedidoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PedidoEnPantallaDto> {
    return this.flujo.avanzarEnOperaciones(id, dto.estado, usuario, dto.nota);
  }
}
