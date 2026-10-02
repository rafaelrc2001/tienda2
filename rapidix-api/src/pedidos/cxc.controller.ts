import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CxcService, FiltroCxc, ListadoCxcDto, PedidoCxcDto } from './cxc.service';
import { RegistrarPagoDto } from './dto/registrar-pago.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { SoloPersonal } from '../auth/solo-personal.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';

/**
 * Administracion -> Finanzas -> CXC: lo que los clientes quedaron a deber y
 * los pagos con que lo van cubriendo.
 */
@ApiTags('Administración · Finanzas')
@ApiBearerAuth()
@Controller('admin/finanzas/cxc')
@RequiereSeccion('finanzas')
@SoloPersonal()
export class CxcController {
  constructor(private readonly cxc: CxcService) {}

  /**
   * Las cuentas de una pestana —`con-saldo` o `cobradas`— con sus productos,
   * sus pagos y su saldo ya calculado, cuantas hay en cada una y lo que se
   * debe en total.
   */
  @Get()
  listar(
    @Query('filtro', new DefaultValuePipe(FiltroCxc.CON_SALDO), new ParseEnumPipe(FiltroCxc))
    filtro: FiltroCxc,
    @Query('limite', new ParseIntPipe({ optional: true })) limite?: number,
  ): Promise<ListadoCxcDto> {
    return this.cxc.listar(filtro, Math.min(limite ?? 100, 500));
  }

  /**
   * Registra un pago, que puede ser parcial, y lo anota en Ingresos. El que
   * deja la cuenta en cero pasa el pedido a Pagado. 409 `PAGO_EXCEDE_SALDO` si
   * pasa de lo que se debe y `NO_ES_CXC` si el pedido no es una cuenta por
   * cobrar o ya esta cobrada.
   *
   * Responde 200 y no 201: lo util de la respuesta es la cuenta ya con el
   * pago, no el pago como recurso.
   */
  @Post(':pedidoId/pagos')
  @HttpCode(HttpStatus.OK)
  registrarPago(
    @Param('pedidoId', ParseUUIDPipe) pedidoId: string,
    @Body() dto: RegistrarPagoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PedidoCxcDto> {
    return this.cxc.registrarPago(pedidoId, dto, usuario);
  }
}
