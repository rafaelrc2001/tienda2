import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EvidenciaEntregaDto, RutasService } from './rutas.service';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { SoloPersonal } from '../auth/solo-personal.decorator';

/**
 * La prueba de entrega de un pedido: foto, ubicacion y quien lo entrego.
 *
 * Va aparte de la bitacora porque no es un cambio de estado sino la evidencia
 * del ultimo, y porque la foto y las coordenadas son datos que solo necesita
 * el personal: el que tiene que responder cuando alguien dice que no le llego.
 * `@SoloPersonal` lo cierra al cliente aunque se le agregue una seccion suya.
 */
@ApiTags('Administración · Pedidos')
@ApiBearerAuth()
@Controller('admin/pedidos')
@SoloPersonal()
export class EvidenciaController {
  constructor(private readonly rutas: RutasService) {}

  /** `null` mientras el pedido no se haya entregado a domicilio. */
  @Get(':id/evidencia')
  @RequiereSeccion('operaciones', 'rutas', 'finanzas')
  evidencia(@Param('id', ParseUUIDPipe) id: string): Promise<EvidenciaEntregaDto | null> {
    return this.rutas.evidencia(id);
  }
}
