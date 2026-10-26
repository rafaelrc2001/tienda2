import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { ROL_CLIENTE, UsuarioAutenticado } from '../auth/jwt-payload';
import {
  DatosFiscalesRespuesta,
  FacturacionService,
  FacturaDto,
  VistaFacturaDto,
} from './facturacion.service';
import { DatosFiscalesDto, FacturarPedidoDto } from './dto/factura.dto';

/**
 * Facturacion del cliente: sus datos fiscales y el CFDI de cada pedido.
 *
 * No es una seccion del panel, asi que el rol se comprueba a mano como en
 * `pedidos.controller.ts`. Comparte el prefijo `pedidos/` con aquel sin
 * chocar: aqui todas las rutas terminan en `/factura`.
 */
@ApiTags('Facturación')
@ApiBearerAuth()
@Controller()
export class FacturacionController {
  constructor(private readonly facturacion: FacturacionService) {}

  /** Lo guardado para pre-llenar el formulario, mas los catalogos del SAT. */
  @Get('perfil/datos-fiscales')
  datosFiscales(@UsuarioActual() usuario: UsuarioAutenticado): Promise<DatosFiscalesRespuesta> {
    soloCliente(usuario);
    return this.facturacion.datosFiscales(usuario.sub);
  }

  @Put('perfil/datos-fiscales')
  guardarDatosFiscales(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: DatosFiscalesDto,
  ): Promise<DatosFiscalesRespuesta> {
    soloCliente(usuario);
    return this.facturacion.guardarDatosFiscales(usuario.sub, dto);
  }

  /**
   * Timbra el CFDI del pedido. 409 con su `code` si ya tiene uno o si todavia
   * no esta pagado; 422 `TIMBRADO_RECHAZADO` con el motivo del SAT
   * si los datos fiscales no pasan.
   */
  @Post('pedidos/:id/factura')
  @HttpCode(HttpStatus.CREATED)
  facturar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FacturarPedidoDto,
  ): Promise<FacturaDto> {
    soloCliente(usuario);
    return this.facturacion.facturar(usuario.sub, id, dto);
  }

  /** El CFDI que se timbraria con estos datos, sin timbrar. Mismos candados que el POST. */
  @Post('pedidos/:id/factura/vista-previa')
  @HttpCode(HttpStatus.OK)
  previsualizar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FacturarPedidoDto,
  ): Promise<VistaFacturaDto> {
    soloCliente(usuario);
    return this.facturacion.previsualizar(usuario.sub, id, dto);
  }

  @Get('pedidos/:id/factura/pdf')
  async pdf(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.enviar(usuario, id, 'pdf', res);
  }

  @Get('pedidos/:id/factura/xml')
  async xml(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.enviar(usuario, id, 'xml', res);
  }

  private async enviar(
    usuario: UsuarioAutenticado,
    pedidoId: string,
    formato: 'pdf' | 'xml',
    res: Response,
  ): Promise<void> {
    soloCliente(usuario);
    const documento = await this.facturacion.documento(usuario.sub, pedidoId, formato);
    res.set({
      'Content-Type': documento.tipo,
      'Content-Disposition': `attachment; filename="${documento.nombre}"`,
      // Datos fiscales del cliente: que no se quede en ningun cache intermedio.
      'Cache-Control': 'private, no-store',
    });
    res.send(documento.contenido);
  }
}

function soloCliente(usuario: UsuarioAutenticado): void {
  if (usuario.rol !== ROL_CLIENTE) {
    throw new ForbiddenException('Esta sección es exclusiva para clientes.');
  }
}
