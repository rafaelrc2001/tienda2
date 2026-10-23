import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { SoloPersonal } from '../auth/solo-personal.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import {
  DatosFacturaGlobalDto,
  FacturaGlobalDto,
  FacturaGlobalService,
  VistaFacturaGlobalDto,
} from './factura-global.service';
import { PrevisualizarFacturaGlobalDto, TimbrarFacturaGlobalDto } from './dto/factura-global.dto';

/**
 * Finanzas -> Bancos -> Factura global: los depositos palomeados en el estado
 * de cuenta, facturados a PUBLICO EN GENERAL.
 *
 * Vive en el modulo de facturacion (es quien tiene el timbrador) con el
 * prefijo de Bancos, que es donde se usa. `factura-global` es literal y no
 * choca con las rutas de `AdminBancosController`.
 */
@ApiTags('Administración · Finanzas')
@ApiBearerAuth()
@Controller('admin/finanzas/bancos/factura-global')
@RequiereSeccion('finanzas')
@SoloPersonal()
export class AdminFacturaGlobalController {
  constructor(private readonly facturaGlobal: FacturaGlobalService) {}

  /** El receptor fijo, los catalogos del SAT y los productos para elegir. */
  @Get('datos')
  datos(): Promise<DatosFacturaGlobalDto> {
    return this.facturaGlobal.datos();
  }

  /** Reparte el total entre los productos sin timbrar nada. */
  @Post('previsualizar')
  @HttpCode(HttpStatus.OK)
  previsualizar(@Body() dto: PrevisualizarFacturaGlobalDto): Promise<VistaFacturaGlobalDto> {
    return this.facturaGlobal.previsualizar(dto);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  timbrar(
    @Body() dto: TimbrarFacturaGlobalDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<FacturaGlobalDto> {
    return this.facturaGlobal.timbrar(dto, usuario.sub);
  }

  @Get(':id/pdf')
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    await this.enviar(id, 'pdf', res);
  }

  @Get(':id/xml')
  async xml(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    await this.enviar(id, 'xml', res);
  }

  private async enviar(id: string, formato: 'pdf' | 'xml', res: Response): Promise<void> {
    const documento = await this.facturaGlobal.documento(id, formato);
    res.set({
      'Content-Type': documento.tipo,
      'Content-Disposition': `attachment; filename="${documento.nombre}"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(documento.contenido);
  }
}
