import { Module } from '@nestjs/common';
import { PedidosModule } from '../pedidos/pedidos.module';
import { InventarioModule } from '../inventario/inventario.module';
import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { RutasService } from './rutas.service';
import { CortesService } from './cortes.service';
import { RutasController } from './rutas.controller';
import { FinanzasCortesController } from './finanzas-cortes.controller';

/**
 * Rutas vive aparte de Pedidos aunque mueva pedidos: lo suyo es la jornada, el
 * camion y el corte, y toma prestado de `PedidosModule` lo que ya sabe mover el
 * eje fisico (`FlujoPedidosService`) y leer un pedido (`PedidosService`).
 *
 * Del corte cuelgan las otras dos: la mercancia devuelta vuelve a bodega por
 * `InventarioService`, y `ConfiguracionService` dice si el control de
 * inventario esta encendido para saber si hay que tocar el saldo.
 */
@Module({
  imports: [PedidosModule, InventarioModule, ConfiguracionModule],
  controllers: [RutasController, FinanzasCortesController],
  providers: [RutasService, CortesService],
  exports: [RutasService, CortesService],
})
export class RutasModule {}
