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
  autorDe,
  DatosFiscalesRespuesta,
  FacturacionService,
  FacturaDto,
  VistaFacturaDto,
} from './facturacion.service';
import { FacturarPedidoFinanzasDto } from './dto/factura.dto';
import { EmisorOpcionDto } from './emisor.service';

/**
 * Finanzas factura un pedido a nombre de su cliente, para quien no lo pide
 * desde la app.
 *
 * Es el mismo `FacturacionService` que usa el cliente en Mis pedidos, con el
 * cliente sacado del pedido: los mismos candados (pagado, un CFDI por
 * pedido), los mismos conceptos y los datos fiscales de su perfil. Sus
 * rutas terminan en `/factura` o `/datos-fiscales` y no chocan con las de
 * `FinanzasController`, que comparte el prefijo.
 */
@ApiTags('Administración · Finanzas')
@ApiBearerAuth()
@Controller('admin/finanzas/pedidos')
@RequiereSeccion('finanzas')
@SoloPersonal()
export class AdminFacturacionController {
  constructor(private readonly facturacion: FacturacionService) {}

  /**
   * Lo que el cliente tiene guardado, para pre-llenar, los catalogos del SAT
   * y con quien se puede emitir (Finanzas elige; sale el de la tienda).
   */
  @Get(':id/datos-fiscales')
  async datosFiscales(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DatosFiscalesRespuesta & { emisores: EmisorOpcionDto[]; emisorSugerido: string }> {
    const [datos, emisores] = await Promise.all([
      this.facturacion.clienteDelPedido(id).then((c) => this.facturacion.datosFiscales(c)),
      this.facturacion.emisoresParaPedido(id),
    ]);
    return { ...datos, ...emisores };
  }

  /** Timbra el CFDI a nombre del cliente. Mismos codigos que `POST /pedidos/:id/factura`. */
  @Post(':id/factura')
  @HttpCode(HttpStatus.CREATED)
  async facturar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FacturarPedidoFinanzasDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<FacturaDto> {
    // El CFDI es del cliente; quien lo pidio queda como autor.
    return this.facturacion.facturar(
      await this.facturacion.clienteDelPedido(id),
      id,
      dto,
      autorDe(usuario),
    );
  }

  /** El CFDI que se timbraria, sin timbrar. Mismos codigos que `POST /pedidos/:id/factura/vista-previa`. */
  @Post(':id/factura/vista-previa')
  @HttpCode(HttpStatus.OK)
  async previsualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FacturarPedidoFinanzasDto,
  ): Promise<VistaFacturaDto> {
    return this.facturacion.previsualizar(await this.facturacion.clienteDelPedido(id), id, dto);
  }

  @Get(':id/factura/pdf')
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    await this.enviar(id, 'pdf', res);
  }

  @Get(':id/factura/xml')
  async xml(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    await this.enviar(id, 'xml', res);
  }

  private async enviar(pedidoId: string, formato: 'pdf' | 'xml', res: Response): Promise<void> {
    const clienteId = await this.facturacion.clienteDelPedido(pedidoId);
    const documento = await this.facturacion.documento(clienteId, pedidoId, formato);
    res.set({
      'Content-Type': documento.tipo,
      'Content-Disposition': `attachment; filename="${documento.nombre}"`,
      // Datos fiscales del cliente: que no se quede en ningun cache intermedio.
      'Cache-Control': 'private, no-store',
    });
    res.send(documento.contenido);
  }
}
