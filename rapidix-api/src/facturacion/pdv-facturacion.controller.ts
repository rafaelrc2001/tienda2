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
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { DocumentoFactura, VistaFacturaDto } from './facturacion.service';
import {
  DatosFacturaPdvDto,
  FacturacionPdvService,
  FacturaPdvDto,
  PedidoPorFacturarDto,
} from './facturacion-pdv.service';
import { FacturaEmitidaDto } from './facturas-emitidas.service';
import { FacturarPedidosPdvDto, PedidosAFacturarDto } from './dto/factura-pdv.dto';

/**
 * PDV -> Facturacion: los pedidos de la tienda, su factura y sus archivos.
 *
 * Comparte el prefijo `admin/pdv/tiendas/:id` con los controladores del punto
 * de venta; todas sus rutas llevan el segmento literal `facturacion` y no
 * chocan con las de ellos.
 */
@ApiTags('PDV')
@ApiBearerAuth()
@Controller('admin/pdv/tiendas/:tiendaId/facturacion')
@RequiereSeccion('pdv')
export class PdvFacturacionController {
  constructor(private readonly facturacion: FacturacionPdvService) {}

  /** Los pedidos sin factura, con `bloqueo` si todavia no se pueden facturar. */
  @Get('pedidos')
  porFacturar(
    @Param('tiendaId', ParseUUIDPipe) tiendaId: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PedidoPorFacturarDto[]> {
    return this.facturacion.porFacturar(tiendaId, usuario);
  }

  @Get('facturas')
  facturadas(
    @Param('tiendaId', ParseUUIDPipe) tiendaId: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<FacturaEmitidaDto[]> {
    return this.facturacion.facturadas(tiendaId, usuario);
  }

  /** Lo que la hoja necesita: razones sociales, catalogos y lo guardado del cliente. */
  @Post('datos')
  @HttpCode(HttpStatus.OK)
  datos(
    @Param('tiendaId', ParseUUIDPipe) tiendaId: string,
    @Body() dto: PedidosAFacturarDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<DatosFacturaPdvDto> {
    return this.facturacion.datos(tiendaId, dto.pedidoIds, usuario);
  }

  /** El CFDI que se timbraria, sin timbrar. Mismos candados que el POST. */
  @Post('vista-previa')
  @HttpCode(HttpStatus.OK)
  previsualizar(
    @Param('tiendaId', ParseUUIDPipe) tiendaId: string,
    @Body() dto: FacturarPedidosPdvDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<VistaFacturaDto> {
    return this.facturacion.previsualizar(tiendaId, dto, usuario);
  }

  /**
   * Timbra uno o varios pedidos en una factura. Mismos codigos que
   * `POST /pedidos/:id/factura`, mas 400 `RAZON_SOCIAL_NO_DISPONIBLE`.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  facturar(
    @Param('tiendaId', ParseUUIDPipe) tiendaId: string,
    @Body() dto: FacturarPedidosPdvDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<FacturaPdvDto> {
    return this.facturacion.facturar(tiendaId, dto, usuario);
  }

  @Get('facturas/:id/pdf')
  async pdf(
    @Param('tiendaId', ParseUUIDPipe) tiendaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Res() res: Response,
  ): Promise<void> {
    enviar(await this.facturacion.documento(tiendaId, id, 'pdf', usuario), res);
  }

  @Get('facturas/:id/xml')
  async xml(
    @Param('tiendaId', ParseUUIDPipe) tiendaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Res() res: Response,
  ): Promise<void> {
    enviar(await this.facturacion.documento(tiendaId, id, 'xml', usuario), res);
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
