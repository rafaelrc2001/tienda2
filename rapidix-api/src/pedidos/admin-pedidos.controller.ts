import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { PedidoDto, PedidosService } from './pedidos.service';
import { BitacoraDto, FlujoPedidosService } from './flujo-pedidos.service';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { SoloPersonal } from '../auth/solo-personal.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { actorDe } from './bitacora';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

/**
 * Administracion -> Mis Pedidos: historial completo de la plataforma.
 *
 * "mis-pedidos" es tambien la seccion del cliente (su historial en Mi Perfil,
 * que sale de `GET /pedidos/mios`), asi que la matriz sola le abriria los
 * pedidos de todos. `@SoloPersonal` en la clase cierra este controlador entero,
 * incluidos los endpoints que se le agreguen despues.
 */
@ApiTags('Administración · Pedidos')
@ApiBearerAuth()
@Controller('admin/pedidos')
@RequiereSeccion('mis-pedidos')
@SoloPersonal()
export class AdminPedidosController {
  constructor(
    private readonly pedidos: PedidosService,
    private readonly flujo: FlujoPedidosService,
  ) {}

  @Get()
  listar(
    @Query('limite', new ParseIntPipe({ optional: true })) limite?: number,
  ): Promise<PedidoDto[]> {
    return this.pedidos.todos(Math.min(limite ?? 100, 500));
  }

  /**
   * Quien y cuando movio el pedido, en sus dos ejes. La consulta cualquiera
   * que lo trabaje: cada seccion necesita ver lo que hicieron las otras.
   */
  @Get(':id/bitacora')
  @RequiereSeccion('mis-pedidos', 'operaciones', 'rutas', 'finanzas')
  bitacora(@Param('id', ParseUUIDPipe) id: string): Promise<BitacoraDto[]> {
    return this.flujo.bitacora(id);
  }

  /**
   * Validar una transferencia (HU-11). Es trabajo de Finanzas, no de quien
   * solo consulta pedidos: la seccion del metodo pisa la de la clase.
   */
  @Patch(':id/pago')
  @RequiereSeccion('finanzas')
  validarPago(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PedidoDto> {
    return this.pedidos.validarPago(id, actorDe(usuario));
  }
}
