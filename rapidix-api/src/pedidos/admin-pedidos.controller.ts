import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
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

  /**
   * Validar una transferencia (HU-11). Es trabajo de Finanzas, no de quien
   * solo consulta pedidos: la seccion del metodo pisa la de la clase.
   */
  @Patch(':id/pago')
  @RequiereSeccion('finanzas')
  validarPago(@Param('id', ParseUUIDPipe) id: string): Promise<PedidoDto> {
    return this.pedidos.validarPago(id);
  }
}
