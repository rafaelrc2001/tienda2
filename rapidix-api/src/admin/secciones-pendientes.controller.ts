import { Controller, Get, NotImplementedException } from '@nestjs/common';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

/**
 * Secciones del panel que existen como roles y permisos de acceso pero cuyo
 * contenido todavia no se construye (Word 3.3). Operaciones ya salio de aqui
 * (`pedidos/operaciones.controller.ts`); Rutas y Finanzas salen en sus etapas.
 *
 * Los endpoints existen para que el control de acceso sea verificable de
 * punta a punta: quien no tiene permiso recibe 403, y quien lo tiene recibe
 * un 501 explicito en vez de un 404 confuso.
 */
const PENDIENTE =
  'Esta sección todavía está en construcción. Llega en una de las siguientes etapas de Operaciones, Rutas y Finanzas.';

@ApiTags('Administración')
@ApiBearerAuth()
@Controller('admin')
export class SeccionesPendientesController {
  @Get('rutas')
  @RequiereSeccion('rutas')
  rutas(): never {
    throw new NotImplementedException(PENDIENTE);
  }

  @Get('finanzas')
  @RequiereSeccion('finanzas')
  finanzas(): never {
    throw new NotImplementedException(PENDIENTE);
  }
}
