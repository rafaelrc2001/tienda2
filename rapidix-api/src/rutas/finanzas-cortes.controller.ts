import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CorteDto, CortesService, FiltroCortes, ListadoCortesDto } from './cortes.service';
import { RecibirCorteDto, RegistrarAbonoDto } from './dto/corte.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { SoloPersonal } from '../auth/solo-personal.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';

/**
 * Administracion -> Finanzas -> Cortes: recibir el dinero que traen los
 * repartidores.
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

  @Get()
  listar(
    @Query(
      'filtro',
      new DefaultValuePipe(FiltroCortes.POR_RECIBIR),
      new ParseEnumPipe(FiltroCortes),
    )
    filtro: FiltroCortes,
    @Query('limite', new ParseIntPipe({ optional: true })) limite?: number,
  ): Promise<ListadoCortesDto> {
    return this.cortes.listar(filtro, Math.min(limite ?? 100, 500));
  }

  @Get(':id')
  detalle(@Param('id', ParseUUIDPipe) id: string): Promise<CorteDto> {
    return this.cortes.detalle(id);
  }

  /**
   * Cuenta el dinero y cierra el corte. **Quien recibe no puede ser quien lo
   * cerró** (409 `RECIBE_EL_MISMO`): el que trae el dinero no se lo cuenta a
   * sí mismo. El administrador sí puede, porque puede ser el único usuario.
   * Contar de menos no bloquea: el faltante queda a la vista.
   */
  @Post(':id/recibir')
  recibir(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecibirCorteDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CorteDto> {
    return this.cortes.recibir(id, dto, usuario);
  }

  /** Lo que el repartidor entrega después, si al recibir faltó dinero. */
  @Post(':id/abonos')
  abonar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegistrarAbonoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CorteDto> {
    return this.cortes.abonar(id, dto, usuario);
  }
}
