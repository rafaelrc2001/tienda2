import { Module } from '@nestjs/common';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { PedidosModule } from '../pedidos/pedidos.module';
import { TiendasModule } from '../tiendas/tiendas.module';
import { PdvService } from './pdv.service';
import { TurnosController } from './turnos.controller';

/**
 * El punto de venta no tiene reglas de precio ni de pedido propias: toma
 * prestado de `PedidosModule` el carrito, el checkout y el cobro, de
 * `CatalogoModule` el orden de la Tienda y de `TiendasModule` el inventario
 * del que sale lo que se entrega en mostrador.
 */
@Module({
  imports: [PedidosModule, CatalogoModule, TiendasModule, ConfiguracionModule],
  controllers: [TurnosController],
  providers: [PdvService],
})
export class PdvModule {}
