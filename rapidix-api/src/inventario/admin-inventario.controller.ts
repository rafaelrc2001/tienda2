import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  InventarioService,
  MovimientoDto,
  ResumenLoteDto,
  SaldoProductoDto,
} from './inventario.service';
import { BuscarMovimientosDto, RegistrarMovimientosDto } from './dto/movimiento.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';

/**
 * Administracion -> Productos, ventanas de Inventario y Movimientos.
 *
 * Cuelga de la misma seccion `productos` que el catalogo: quien puede dar de
 * alta un producto es quien mueve su mercancia.
 */
@ApiTags('Administración · Inventario')
@ApiBearerAuth()
@Controller('admin/inventario')
@RequiereSeccion('productos')
export class AdminInventarioController {
  constructor(private readonly inventario: InventarioService) {}

  /** Saldo de todos los productos (I-1). Solo lectura, por diseño. */
  @Get()
  saldos(): Promise<SaldoProductoDto[]> {
    return this.inventario.saldos();
  }

  /** Bitacora: quien movio que, cuando y por que (M-11). */
  @Get('movimientos')
  historial(@Query() filtros: BuscarMovimientosDto): Promise<MovimientoDto[]> {
    return this.inventario.historial(filtros);
  }

  /**
   * Registra un lote de movimientos (M-1).
   *
   * Responde 200 y no 201 porque lo que se crea son N renglones de bitacora,
   * no un recurso con URL propia: lo util de la respuesta es el resumen.
   */
  @Post('movimientos')
  @HttpCode(HttpStatus.OK)
  registrar(
    @Body() dto: RegistrarMovimientosDto,
    @UsuarioActual() usuario: UsuarioAutenticado | undefined,
  ): Promise<ResumenLoteDto> {
    return this.inventario.registrarLote(dto, usuario);
  }
}
