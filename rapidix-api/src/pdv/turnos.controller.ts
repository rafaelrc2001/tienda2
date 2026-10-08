import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { PrevisualizacionCarritoDto } from '../pedidos/carrito.service';
import { PedidoDto, UltimoPedidoDto } from '../pedidos/pedidos.service';
import {
  CatalogoPdvDto,
  ClientePdvDto,
  PdvService,
  TurnoConPedidosDto,
  TurnoDto,
} from './pdv.service';
import {
  AbrirTurnoDto,
  BuscarClienteDto,
  CorteDeCajaDto,
  CrearPedidoPdvDto,
  DeLaTiendaDto,
  PrevisualizarPdvDto,
  RegistrarClienteDto,
  SugerirClientesDto,
} from './dto/pdv.dto';

/**
 * PDV -> Punto de Venta y Corte de caja: el turno, sus pedidos y su cierre.
 *
 * Comparte prefijo con `tiendas/pdv.controller.ts`, que lleva la pestana
 * Inventario. `turnos/abierto` va antes que `turnos/:id` para que no lo
 * capture.
 */
@ApiTags('PDV')
@ApiBearerAuth()
@Controller('admin/pdv')
@RequiereSeccion('pdv')
export class TurnosController {
  constructor(private readonly pdv: PdvService) {}

  /**
   * El turno abierto de quien pregunta en esa tienda. 200 con `null` si no
   * tiene: no es un error.
   */
  @Get('turnos/abierto')
  abierto(
    @Query() dto: DeLaTiendaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<TurnoConPedidosDto | null> {
    return this.pdv.turnoAbierto(dto.tiendaId, usuario);
  }

  /** Los turnos de esa tienda. */
  @Get('turnos')
  listar(
    @Query() dto: DeLaTiendaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<TurnoDto[]> {
    return this.pdv.listar(dto.tiendaId, usuario);
  }

  /** "Crear turno". 409 `TURNO_ABIERTO` si ya tiene uno en esa tienda. */
  @Post('turnos')
  @HttpCode(HttpStatus.CREATED)
  abrir(
    @Body() dto: AbrirTurnoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<TurnoConPedidosDto> {
    return this.pdv.abrir(dto, usuario);
  }

  @Get('turnos/:id')
  detalle(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<TurnoConPedidosDto> {
    return this.pdv.detalle(id, usuario);
  }

  /** El corte de caja. 409 `TURNO_CERRADO`, `TURNO_CON_PENDIENTES`. */
  @Post('turnos/:id/corte')
  @HttpCode(HttpStatus.OK)
  cerrar(
    @Param('id') id: string,
    @Body() dto: CorteDeCajaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<TurnoConPedidosDto> {
    return this.pdv.cerrar(id, dto, usuario);
  }

  /** El desglose de la orden, sin confirmar nada. Responde 200 aunque no se pueda pedir. */
  @Post('turnos/:id/previsualizar')
  @HttpCode(HttpStatus.OK)
  previsualizar(
    @Param('id') id: string,
    @Body() dto: PrevisualizarPdvDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PrevisualizacionCarritoDto> {
    return this.pdv.previsualizar(id, dto, usuario);
  }

  /** "Confirmar pedido". 409 `SIN_DIRECCION` si va a domicilio y el perfil no la tiene. */
  @Post('turnos/:id/pedidos')
  @HttpCode(HttpStatus.CREATED)
  crearPedido(
    @Param('id') id: string,
    @Body() dto: CrearPedidoPdvDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PedidoDto> {
    return this.pdv.crearPedido(id, dto, usuario);
  }

  /** "Entregado": sale del inventario de la tienda y queda cobrado. */
  @Post('pedidos/:id/entregar')
  @HttpCode(HttpStatus.OK)
  entregar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PedidoDto> {
    return this.pdv.entregar(id, usuario);
  }

  /** Autocompletado: los registrados cuyo telefono contiene lo tecleado. */
  @Get('clientes/sugerencias')
  sugerirClientes(@Query() dto: SugerirClientesDto): Promise<ClientePdvDto[]> {
    return this.pdv.sugerirClientes(dto.telefono);
  }

  /** 200 con `null` si ese telefono no esta registrado: toca pedir el nombre. */
  @Get('clientes')
  buscarCliente(@Query() dto: BuscarClienteDto): Promise<ClientePdvDto | null> {
    return this.pdv.buscarCliente(dto.telefono);
  }

  @Post('clientes')
  @HttpCode(HttpStatus.OK)
  registrarCliente(@Body() dto: RegistrarClienteDto): Promise<ClientePdvDto> {
    return this.pdv.registrarCliente(dto);
  }

  /** El catalogo de ese cliente con lo que tiene la tienda desde la que se vende. */
  @Get('clientes/:id/catalogo')
  catalogo(@Param('id') id: string, @Query() dto: DeLaTiendaDto): Promise<CatalogoPdvDto> {
    return this.pdv.catalogo(id, dto.tiendaId);
  }

  @Get('clientes/:id/ultimo-pedido')
  ultimoPedido(@Param('id') id: string): Promise<UltimoPedidoDto | null> {
    return this.pdv.ultimoPedido(id);
  }
}
