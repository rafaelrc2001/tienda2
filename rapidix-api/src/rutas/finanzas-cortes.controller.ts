import {
  Body,
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
import {
  CorteDto,
  CortesService,
  DetalleCorteDto,
  FiltroCortes,
  ListadoCortesDto,
} from './cortes.service';
import { RechazarDevolucionDto } from './dto/corte.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { SoloPersonal } from '../auth/solo-personal.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';

/**
 * Administracion -> Finanzas -> Cortes de ruta: aceptar la mercancia y el
 * dinero que traen los repartidores.
 *
 * Vive en el modulo de Rutas aunque lo use Finanzas, igual que
 * `pedidos/finanzas.controller.ts` vive en el de Pedidos: el dominio manda
 * sobre la audiencia, y el corte es de Rutas.
 */
@ApiTags('Administración · Finanzas')
@ApiBearerAuth()
@Controller('admin/finanzas/cortes')
@RequiereSeccion('finanzas')
@SoloPersonal()
export class FinanzasCortesController {
  constructor(private readonly cortes: CortesService) {}

  /**
   * Los cortes de una pestana —`por-aceptar` (Liquidado), `con-adeudo`
   * (Aceptado) o `cerrados`— con cuantos hay en cada una.
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
  ): Promise<ListadoCortesDto> {
    return this.cortes.listar(filtro, Math.min(limite ?? 100, 500));
  }

  /**
   * El corte con lo que salio en su entrega y el conteo por producto de lo que
   * baja del camion: contra eso se revisa la devolucion antes de aceptarla.
   */
  @Get(':id')
  detalle(@Param('id', ParseUUIDPipe) id: string): Promise<DetalleCorteDto> {
    return this.cortes.detalleParaFinanzas(id);
  }

  /**
   * "Aceptar devolucion": descarga el camion de esa entrega y devuelve la
   * mercancia al inventario. Es lo primero que se acepta de un corte. 409
   * `DEVOLUCION_YA_ACEPTADA` si ya se hizo y `RECIBE_EL_MISMO` si quien
   * acepta es quien liquido (salvo el administrador).
   */
  @Post(':id/aceptar-devolucion')
  @HttpCode(HttpStatus.OK)
  aceptarDevolucion(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CorteDto> {
    return this.cortes.aceptarDevolucion(id, usuario);
  }

  /**
   * "Rechazar devolucion": lo que regreso no es lo que se conto. Deshace la
   * liquidacion entera —el corte se borra y la entrega vuelve a "terminada,
   * sin liquidar"— y deja el `motivo` (obligatorio) en la entrega para que el
   * repartidor lo lea. 409 `DEVOLUCION_YA_ACEPTADA` si ya se acepto. No
   * devuelve nada: el corte ya no existe.
   */
  @Post(':id/rechazar-devolucion')
  @HttpCode(HttpStatus.NO_CONTENT)
  rechazarDevolucion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RechazarDevolucionDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<void> {
    return this.cortes.rechazarDevolucion(id, dto, usuario);
  }

  /**
   * "Aceptar dinero": acepta lo que el repartidor declaro —o el abono que
   * tenga pendiente— sin capturar otra cifra, y lo anota en Ingresos. 409
   * `DEVOLUCION_SIN_ACEPTAR` si la devolucion va primero y no se ha aceptado,
   * `SIN_DINERO_POR_ACEPTAR` si no hay nada pendiente y `RECIBE_EL_MISMO` si
   * quien acepta es quien liquido (salvo el administrador).
   */
  @Post(':id/aceptar-dinero')
  @HttpCode(HttpStatus.OK)
  aceptarDinero(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CorteDto> {
    return this.cortes.aceptarDinero(id, usuario);
  }

  /**
   * "Entrega aceptada": con la devolucion y el dinero aceptados, deja pagados
   * los pedidos en efectivo, manda a CXC los de credito y pone el corte en
   * Cerrado o, si el repartidor debe, en Aceptado. 409
   * `DEVOLUCION_SIN_ACEPTAR`, `DINERO_SIN_ACEPTAR`, `ENTREGA_YA_ACEPTADA` y
   * `RECIBE_EL_MISMO`.
   */
  @Post(':id/aceptar-entrega')
  @HttpCode(HttpStatus.OK)
  aceptarEntrega(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CorteDto> {
    return this.cortes.aceptarEntrega(id, usuario);
  }
}
