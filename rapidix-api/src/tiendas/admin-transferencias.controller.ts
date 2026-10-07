import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Tienda } from '@prisma/client';
import { TiendasService } from './tiendas.service';
import { TransferenciaDto, TransferenciasService } from './transferencias.service';
import { BuscarTransferenciasDto, CrearTransferenciaDto } from './dto/transferencia.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';

/**
 * Administracion -> Productos, ventana Movimientos: el lado de bodega de una
 * transferencia. Aqui se arma y, mientras la tienda no la acepte, se cancela.
 *
 * Comparte prefijo con `AdminInventarioController` y su misma seccion: quien
 * mueve la mercancia de bodega es quien la manda a una tienda.
 */
@ApiTags('Administración · Inventario')
@ApiBearerAuth()
@Controller('admin/inventario')
@RequiereSeccion('productos')
export class AdminTransferenciasController {
  constructor(
    private readonly transferencias: TransferenciasService,
    private readonly tiendas: TiendasService,
  ) {}

  /** Los destinos posibles: solo las tiendas activas. */
  @Get('tiendas')
  destinos(): Promise<Tienda[]> {
    return this.tiendas.activas();
  }

  @Get('transferencias')
  listar(@Query() filtros: BuscarTransferenciasDto): Promise<TransferenciaDto[]> {
    return this.transferencias.listar(filtros);
  }

  @Post('transferencias')
  @HttpCode(HttpStatus.CREATED)
  crear(
    @Body() dto: CrearTransferenciaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<TransferenciaDto> {
    return this.transferencias.crear(dto, usuario);
  }

  @Post('transferencias/:id/cancelar')
  @HttpCode(HttpStatus.OK)
  cancelar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<TransferenciaDto> {
    return this.transferencias.cancelar(id, usuario);
  }
}
