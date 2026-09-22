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
  FiltroFinanzas,
  FinanzasService,
  ListadoFinanzasDto,
  PedidoEnFinanzasDto,
} from './finanzas.service';
import { CambiarPagoDto } from './dto/cambiar-pago.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { SoloPersonal } from '../auth/solo-personal.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';

/**
 * Administracion -> Finanzas: decidir sobre el dinero de cada pedido.
 *
 * Es el unico sitio por el que se escribe `estadoPago`, para que las reglas y
 * los efectos de cada estatus no se repitan en dos caminos distintos.
 */
@ApiTags('Administración · Finanzas')
@ApiBearerAuth()
@Controller('admin/finanzas')
@RequiereSeccion('finanzas')
@SoloPersonal()
export class FinanzasController {
  constructor(private readonly finanzas: FinanzasService) {}

  @Get('pedidos')
  listar(
    @Query(
      'filtro',
      new DefaultValuePipe(FiltroFinanzas.POR_DECIDIR),
      new ParseEnumPipe(FiltroFinanzas),
    )
    filtro: FiltroFinanzas,
    @Query('limite', new ParseIntPipe({ optional: true })) limite?: number,
  ): Promise<ListadoFinanzasDto> {
    return this.finanzas.listar(filtro, Math.min(limite ?? 100, 500));
  }

  /**
   * Cambia el estatus del pago y arrastra lo que ese estatus implique. Los
   * candados responden 409 con su `code` (PAGO_TERMINAL, MERCANCIA_FUERA...).
   */
  @Patch('pedidos/:id/pago')
  cambiar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CambiarPagoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PedidoEnFinanzasDto> {
    return this.finanzas.cambiarPago(id, dto.estado, usuario, dto.nota);
  }
}
