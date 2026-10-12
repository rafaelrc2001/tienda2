import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TiendaParaRecogerDto, TiendasService } from './tiendas.service';
import { Public } from '../auth/public.decorator';

/**
 * El lado del cliente: las tiendas entre las que elige al pedir «Recoger en
 * tienda».
 *
 * Es publico porque el visitante sin sesion tambien arma su carrito, y no
 * expone nada que no este en la fachada de la tienda: nombre y direccion. La
 * persona responsable no viaja.
 */
@ApiTags('Tiendas')
@Controller('tiendas')
export class TiendasController {
  constructor(private readonly tiendas: TiendasService) {}

  @Get()
  @Public()
  listar(): Promise<TiendaParaRecogerDto[]> {
    return this.tiendas.paraRecoger();
  }
}
