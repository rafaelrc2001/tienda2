import { Module } from '@nestjs/common';
import { CarritoService } from './carrito.service';
import { PedidosService } from './pedidos.service';
import { FlujoPedidosService } from './flujo-pedidos.service';
import { FinanzasService } from './finanzas.service';
import { CarritoController } from './carrito.controller';
import { PedidosController } from './pedidos.controller';
import { AdminPedidosController } from './admin-pedidos.controller';
import { OperacionesController } from './operaciones.controller';
import { FinanzasController } from './finanzas.controller';
import { CxcService } from './cxc.service';
import { CxcController } from './cxc.controller';
import { IngresosModule } from '../ingresos/ingresos.module';
import { TiendasModule } from '../tiendas/tiendas.module';

@Module({
  // El pago de una cuenta por cobrar deja su renglon en el libro de ingresos.
  // El pedido que se recoge en tienda se valida contra el inventario de esa tienda.
  imports: [IngresosModule, TiendasModule],
  controllers: [
    CarritoController,
    AdminPedidosController,
    OperacionesController,
    FinanzasController,
    CxcController,
    PedidosController,
  ],
  providers: [CarritoService, PedidosService, FlujoPedidosService, FinanzasService, CxcService],
  exports: [CarritoService, PedidosService, FlujoPedidosService, FinanzasService],
})
export class PedidosModule {}
