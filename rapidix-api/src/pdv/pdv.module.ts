import { Module } from '@nestjs/common';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { IngresosModule } from '../ingresos/ingresos.module';
import { PedidosModule } from '../pedidos/pedidos.module';
import { TiendasModule } from '../tiendas/tiendas.module';
import { PdvService } from './pdv.service';
import { TurnosController } from './turnos.controller';
import { FinanzasCortesDeCajaController } from './finanzas-cortes-de-caja.controller';

/**
 * El punto de venta no tiene reglas de precio ni de pedido propias: toma
 * prestado de `PedidosModule` el carrito, el checkout y el cobro, de
 * `CatalogoModule` el orden de la Tienda y de `TiendasModule` el inventario
 * del que sale lo que se entrega en mostrador. El efectivo de un corte de caja
 * entra al libro de `IngresosModule` cuando Finanzas lo acepta.
 */
@Module({
  imports: [PedidosModule, CatalogoModule, TiendasModule, ConfiguracionModule, IngresosModule],
  controllers: [TurnosController, FinanzasCortesDeCajaController],
  providers: [PdvService],
})
export class PdvModule {}
