import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { SoloPersonal } from '../auth/solo-personal.decorator';
import { EmisorService, EmisorServidorDto } from './emisor.service';

/**
 * Configuracion -> Fiscal -> Emisor: a nombre de quien sale toda factura. Solo
 * lectura: el emisor es la cuenta de factura.com de las llaves del servidor, y
 * se cambia ahi (y en las variables `FACTURACOM_*`), no en Rapidix.
 *
 * `emisor` es literal y no choca con las rutas de
 * `AdminConfiguracionController`, que comparte el prefijo.
 */
@ApiTags('Administración · Configuración')
@ApiBearerAuth()
@Controller('admin/configuracion/emisor')
@RequiereSeccion('configuracion')
@SoloPersonal()
export class AdminEmisorController {
  constructor(private readonly emisor: EmisorService) {}

  @Get()
  ver(): Promise<EmisorServidorDto> {
    return this.emisor.vista();
  }
}
