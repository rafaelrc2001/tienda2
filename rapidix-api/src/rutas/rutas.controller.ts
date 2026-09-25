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
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  DetalleEntregaRutaDto,
  EntregaRutaDto,
  FiltroRutas,
  JornadaDto,
  PedidoEnRutaDto,
  PrevisualizacionEntregaDto,
  ResultadoEntregaDto,
  RutasService,
  TableroRutasDto,
} from './rutas.service';
import { NotaRutaDto } from './dto/nota-ruta.dto';
import { CrearEntregaRutaDto, RecolectarDto } from './dto/entrega-ruta.dto';
import {
  EntregarPedidoDto,
  NoEntregadoDto,
  PrevisualizarEntregaDto,
} from './dto/entregar-pedido.dto';
import { CerrarCorteDto } from './dto/corte.dto';
import { CorteDto, CortesService, ResumenCorteDto } from './cortes.service';
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
  constructor(
    private readonly rutas: RutasService,
    private readonly cortes: CortesService,
  ) {}

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

  /** "Crear entrega": un viaje nuevo de la jornada, con el siguiente numero. */
  @Post('entregas')
  crearEntrega(
    @Body() dto: CrearEntregaRutaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<EntregaRutaDto> {
    return this.rutas.crearEntrega(usuario, dto.nombre);
  }

  /** La entrega con sus pedidos y lo que espera en bodega para agregarle. */
  @Get('entregas/:id')
  entrega(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<DetalleEntregaRutaDto> {
    return this.rutas.detalleEntrega(id, usuario);
  }

  /** "Finalizar entrega": ya no sale nada mas en ella. Sigue viva hasta su corte. */
  @Post('entregas/:id/finalizar')
  finalizarEntrega(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<EntregaRutaDto> {
    return this.rutas.finalizarEntrega(id, usuario);
  }

  /** La vuelve a abrir mientras no tenga corte. */
  @Post('entregas/:id/reanudar')
  reanudarEntrega(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<EntregaRutaDto> {
    return this.rutas.reanudarEntrega(id, usuario);
  }

  /**
   * Lo que el sistema dice que trae de esta entrega, para que cuente contra un
   * número. No cambia nada: se puede pedir las veces que haga falta.
   */
  @Get('entregas/:id/corte')
  previsualizarCorte(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ResumenCorteDto> {
    return this.cortes.previsualizar(usuario, id);
  }

  /**
   * Corta la entrega: liquida lo entregado y **descarga su parte del camión**,
   * que es donde la mercancía devuelta vuelve por fin a bodega. El corte de la
   * última entrega viva cierra también la jornada.
   */
  @Post('entregas/:id/corte')
  cerrarCorte(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CerrarCorteDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CorteDto> {
    return this.cortes.cerrar(usuario, id, dto);
  }

  /**
   * Sube el pedido al camion de quien pulsa, dentro de la entrega que manda.
   * Los candados responden 409 con su `code` (SIN_JORNADA, EN_OTRA_ENTREGA,
   * PEDIDO_DE_OTRO...).
   */
  @Post('pedidos/:id/recolectar')
  recolectar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecolectarDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PedidoEnRutaDto> {
    return this.rutas.recolectar(id, dto.entregaId, usuario, dto.nota);
  }

  /** Lo baja del camion antes de salir: vuelve a bodega. 409 `YA_SALIO` si ya va en ruta. */
  @Post('pedidos/:id/quitar-de-entrega')
  quitarDeEntrega(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PedidoEnRutaDto> {
    return this.rutas.quitarDeEntrega(id, usuario);
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
   * La cuenta de la hoja de entrega mientras se cuenta: lo aceptado, el total a
   * cobrar y el cambio. No cambia nada; la pantalla la pide con cada toque.
   */
  @Post('pedidos/:id/entregar/previsualizar')
  previsualizarEntrega(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrevisualizarEntregaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PrevisualizacionEntregaDto> {
    return this.rutas.previsualizarEntrega(id, dto, usuario);
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

  /** Corrige lo declarado, mientras Finanzas no lo haya recibido. */
  @Patch('cortes/:id')
  corregirCorte(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CerrarCorteDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CorteDto> {
    return this.cortes.corregirDeclarado(id, usuario, dto);
  }
}
