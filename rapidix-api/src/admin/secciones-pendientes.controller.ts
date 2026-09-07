import { Controller, Get, NotImplementedException } from '@nestjs/common';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

/**
 * Rutas, Operaciones y Finanzas existen como roles y como permisos de acceso,
 * pero su contenido funcional no se definio durante el prototipado (Word 3.3)
 * y esta fuera del alcance del SPEC 01.
 *
 * Los endpoints existen para que el control de acceso sea verificable de
 * punta a punta: quien no tiene permiso recibe 403, y quien lo tiene recibe
 * un 501 explicito en vez de un 404 confuso.
 */
const PENDIENTE =
  'Esta sección requiere una ronda de definición funcional propia antes de desarrollarse (Word 3.3). Fuera del alcance del SPEC 01.';

@ApiTags('Administración')
@ApiBearerAuth()
@Controller('admin')
export class SeccionesPendientesController {
  @Get('rutas')
  @RequiereSeccion('rutas')
  rutas(): never {
    throw new NotImplementedException(PENDIENTE);
  }

  @Get('operaciones')
  @RequiereSeccion('operaciones')
  operaciones(): never {
    throw new NotImplementedException(PENDIENTE);
  }

  @Get('finanzas')
  @RequiereSeccion('finanzas')
  finanzas(): never {
    throw new NotImplementedException(PENDIENTE);
  }
}
