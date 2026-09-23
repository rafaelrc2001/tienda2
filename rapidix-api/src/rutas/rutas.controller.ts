import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  FiltroRutas,
  JornadaDto,
  PedidoEnRutaDto,
  ResultadoEntregaDto,
  RutasService,
  TableroRutasDto,
} from './rutas.service';
import { NotaRutaDto } from './dto/nota-ruta.dto';
import { EntregarPedidoDto, NoEntregadoDto } from './dto/entregar-pedido.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { SoloPersonal } from '../auth/solo-personal.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';

/**
 * Administracion -> Rutas: la pantalla del repartidor.
 *
 * Todo cuelga de su jornada, asi que el tablero la devuelve junto con los
 * pedidos: es una sola pantalla de telefono y pedir las dos cosas por separado
 * seria un viaje de mas en cada refresco.
 */
@ApiTags('Administración · Rutas')
@ApiBearerAuth()
@Controller('admin/rutas')
@RequiereSeccion('rutas')
@SoloPersonal()
export class RutasController {
  constructor(private readonly rutas: RutasService) {}

  @Get()
  tablero(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query('filtro', new DefaultValuePipe(FiltroRutas.DISPONIBLES), new ParseEnumPipe(FiltroRutas))
    filtro: FiltroRutas,
    @Query('limite', new ParseIntPipe({ optional: true })) limite?: number,
  ): Promise<TableroRutasDto> {
    return this.rutas.tablero(usuario, filtro, Math.min(limite ?? 100, 500));
  }

  /** "Inicio de entregas". 409 `JORNADA_ABIERTA` si ya estaba trabajando. */
  @Post('jornada')
  abrir(@UsuarioActual() usuario: UsuarioAutenticado): Promise<JornadaDto> {
    return this.rutas.abrirJornada(usuario);
  }

  /** "Finalizar entregas". La jornada sigue viva hasta el corte. */
  @Post('jornada/finalizar')
  finalizar(@UsuarioActual() usuario: UsuarioAutenticado): Promise<JornadaDto> {
    return this.rutas.finalizarJornada(usuario);
  }

  /**
   * Sube el pedido al camion de quien pulsa. Los candados responden 409 con su
   * `code` (SIN_JORNADA, PAGO_NO_LIBERADO, PEDIDO_DE_OTRO...).
   */
  @Post('pedidos/:id/recolectar')
  recolectar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NotaRutaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PedidoEnRutaDto> {
    return this.rutas.recolectar(id, usuario, dto.nota);
  }

  @Post('pedidos/:id/en-ruta')
  enRuta(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NotaRutaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PedidoEnRutaDto> {
    return this.rutas.marcarEnRuta(id, usuario, dto.nota);
  }

  /**
   * Cierra el pedido con lo que el cliente aceptó. Viaja el recuento completo
   * del camión, no solo lo que falló: entregar es contar todo lo que baja.
   */
  @Post('pedidos/:id/entregar')
  entregar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EntregarPedidoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ResultadoEntregaDto> {
    return this.rutas.entregar(id, dto, usuario);
  }

  /**
   * El intento que no llegó a entrega. **No cierra el pedido**: la mercancía
   * sigue en el camión y vuelve a bodega en el corte.
   */
  @Post('pedidos/:id/no-entregar')
  noEntregar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NoEntregadoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ResultadoEntregaDto> {
    return this.rutas.noEntregar(id, dto, usuario);
  }
}
