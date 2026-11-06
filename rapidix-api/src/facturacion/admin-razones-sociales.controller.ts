import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { SoloPersonal } from '../auth/solo-personal.decorator';
import { RazonSocialDto } from './dto/razon-social.dto';
import { RazonesSocialesDto, RazonesSocialesService } from './razones-sociales.service';

/**
 * Configuracion -> Fiscal -> Razones sociales: los emisores con los que se
 * factura. Cada respuesta trae la lista completa para que la pantalla se
 * repinte con una sola peticion.
 *
 * `razones-sociales` es literal y no choca con las rutas de
 * `AdminConfiguracionController`, que comparte el prefijo.
 */
@ApiTags('Administración · Configuración')
@ApiBearerAuth()
@Controller('admin/configuracion/razones-sociales')
@RequiereSeccion('configuracion')
@SoloPersonal()
export class AdminRazonesSocialesController {
  constructor(private readonly razones: RazonesSocialesService) {}

  @Get()
  listar(): Promise<RazonesSocialesDto> {
    return this.razones.listar();
  }

  /** 409 `RFC_REPETIDO`; 400 `REGIMEN_NO_CORRESPONDE` o `LLAVES_INCOMPLETAS`. */
  @Post()
  crear(@Body() dto: RazonSocialDto): Promise<RazonesSocialesDto> {
    return this.razones.crear(dto);
  }

  @Put(':id')
  actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RazonSocialDto,
  ): Promise<RazonesSocialesDto> {
    return this.razones.actualizar(id, dto);
  }

  /** 409 `RAZON_SOCIAL_CON_FACTURAS` si ya emitio alguna: se desactiva en su lugar. */
  @Delete(':id')
  eliminar(@Param('id', ParseUUIDPipe) id: string): Promise<RazonesSocialesDto> {
    return this.razones.eliminar(id);
  }
}
