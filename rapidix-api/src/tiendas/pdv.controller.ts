import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Tienda } from '@prisma/client';
import { ExistenciaTiendaDto, TiendasService } from './tiendas.service';
import { TransferenciaDto, TransferenciasService } from './transferencias.service';
import { BuscarTransferenciasDto } from './dto/transferencia.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';

/**
 * PDV -> Inventario: el lado de la tienda. Ve lo que bodega le mando, lo
 * acepta ("recolectar") y consulta lo que tiene.
 */
@ApiTags('PDV')
@ApiBearerAuth()
@Controller('admin/pdv')
@RequiereSeccion('pdv')
export class PdvController {
  constructor(
    private readonly tiendas: TiendasService,
    private readonly transferencias: TransferenciasService,
  ) {}

  @Get('tiendas')
  listarTiendas(): Promise<Tienda[]> {
    return this.tiendas.activas();
  }

  @Get('tiendas/:id/inventario')
  inventario(@Param('id') id: string): Promise<ExistenciaTiendaDto[]> {
    return this.tiendas.inventario(id);
  }

  @Get('transferencias')
  listarTransferencias(@Query() filtros: BuscarTransferenciasDto): Promise<TransferenciaDto[]> {
    return this.transferencias.listar(filtros);
  }

  /** 409 `TRANSFERENCIA_RESUELTA` si ya se acepto o se cancelo. */
  @Post('transferencias/:id/aceptar')
  @HttpCode(HttpStatus.OK)
  aceptar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<TransferenciaDto> {
    return this.transferencias.aceptar(id, usuario);
  }
}
