import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { SoloPersonal } from '../auth/solo-personal.decorator';
import { DocumentoFactura, FacturacionService } from './facturacion.service';
import { FacturaGlobalService } from './factura-global.service';
import {
  FacturaEmitidaDto,
  FacturasEmitidasService,
  PeriodoFacturasDto,
} from './facturas-emitidas.service';
import { MesFacturasDto } from './dto/facturas-emitidas.dto';

/**
 * Configuracion -> Fiscal -> Facturacion: las facturas que emitio el negocio,
 * mes por mes, con su PDF y su XML.
 *
 * Tiene sus propias rutas de archivos (por id de factura) porque la seccion es
 * Configuracion: quien la ve no necesariamente tiene Finanzas, que es donde
 * viven las de los pedidos y las globales. `facturas` es literal y no choca con
 * las rutas de `AdminConfiguracionController`, que comparte el prefijo.
 */
@ApiTags('Administración · Configuración')
@ApiBearerAuth()
@Controller('admin/configuracion/facturas')
@RequiereSeccion('configuracion')
@SoloPersonal()
export class AdminFacturasController {
  constructor(
    private readonly emitidas: FacturasEmitidasService,
    private readonly facturacion: FacturacionService,
    private readonly facturaGlobal: FacturaGlobalService,
  ) {}

  /** Los meses con facturas, para el selector de periodo. */
  @Get('periodos')
  periodos(): Promise<PeriodoFacturasDto[]> {
    return this.emitidas.periodos();
  }

  @Get()
  delMes(@Query() dto: MesFacturasDto): Promise<FacturaEmitidaDto[]> {
    return this.emitidas.delMes(dto.anio, dto.mes);
  }

  @Get('pedido/:id/pdf')
  async pdfPedido(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    enviar(await this.facturacion.documentoPorId(id, 'pdf'), res);
  }

  @Get('pedido/:id/xml')
  async xmlPedido(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    enviar(await this.facturacion.documentoPorId(id, 'xml'), res);
  }

  @Get('global/:id/pdf')
  async pdfGlobal(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    enviar(await this.facturaGlobal.documento(id, 'pdf'), res);
  }

  @Get('global/:id/xml')
  async xmlGlobal(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    enviar(await this.facturaGlobal.documento(id, 'xml'), res);
  }
}

function enviar(documento: DocumentoFactura, res: Response): void {
  res.set({
    'Content-Type': documento.tipo,
    'Content-Disposition': `attachment; filename="${documento.nombre}"`,
    // Datos fiscales de clientes: que no se quede en ningun cache intermedio.
    'Cache-Control': 'private, no-store',
  });
  res.send(documento.contenido);
}
