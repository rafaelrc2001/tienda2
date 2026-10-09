import {
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { SoloPersonal } from '../auth/solo-personal.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { FiltroCortes } from '../rutas/cortes.service';
import { ListadoCortesDeCajaDto, PdvService, TurnoConPedidosDto, TurnoDto } from './pdv.service';

/**
 * Administracion -> Finanzas -> Cortes: aceptar el efectivo de los cortes de
 * caja del punto de venta.
 *
 * Vive en el modulo del PDV aunque lo use Finanzas, igual que
 * `rutas/finanzas-cortes.controller.ts` vive en el de Rutas: el dominio manda
 * sobre la audiencia. Prefijo propio (`cortes-de-caja`) para no chocar con
 * `admin/finanzas/cortes/:id`, que es de los cortes de ruta.
 */
@ApiTags('Administración · Finanzas')
@ApiBearerAuth()
@Controller('admin/finanzas/cortes-de-caja')
@RequiereSeccion('finanzas')
@SoloPersonal()
export class FinanzasCortesDeCajaController {
  constructor(private readonly pdv: PdvService) {}

  /**
   * Los cortes de caja de una pestana —`por-aceptar`, `con-adeudo` o
   * `cerrados`, las mismas que los de ruta— con cuantos hay en cada una.
   */
  @Get()
  listar(
    @Query(
      'filtro',
      new DefaultValuePipe(FiltroCortes.POR_ACEPTAR),
      new ParseEnumPipe(FiltroCortes),
    )
    filtro: FiltroCortes,
    @Query('limite', new ParseIntPipe({ optional: true })) limite?: number,
  ): Promise<ListadoCortesDeCajaDto> {
    return this.pdv.cortesParaFinanzas(filtro, Math.min(limite ?? 100, 500));
  }

  /** El corte con los pedidos del turno: de ahi sale cada cifra. */
  @Get(':id')
  detalle(@Param('id', ParseUUIDPipe) id: string): Promise<TurnoConPedidosDto> {
    return this.pdv.corteParaFinanzas(id);
  }

  /**
   * "Aceptar dinero": acepta lo que el cajero declaro —o el abono que tenga
   * pendiente— y lo anota en Ingresos. 409 `SIN_DINERO_POR_ACEPTAR` si no hay
   * nada pendiente y `RECIBE_EL_MISMO` si quien acepta es el cajero del turno
   * (salvo el administrador).
   */
  @Post(':id/aceptar-dinero')
  @HttpCode(HttpStatus.OK)
  aceptarDinero(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<TurnoDto> {
    return this.pdv.aceptarDinero(id, usuario);
  }
}
