import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { PedidoDto, PedidosService } from './pedidos.service';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

/** Administracion -> Mis Pedidos: historial completo de la plataforma. */
@ApiTags('Administración · Pedidos')
@ApiBearerAuth()
@Controller('admin/pedidos')
@RequiereSeccion('mis-pedidos')
export class AdminPedidosController {
  constructor(private readonly pedidos: PedidosService) {}

  @Get()
  listar(
    @Query('limite', new ParseIntPipe({ optional: true })) limite?: number,
  ): Promise<PedidoDto[]> {
    return this.pedidos.todos(Math.min(limite ?? 100, 500));
  }
}
