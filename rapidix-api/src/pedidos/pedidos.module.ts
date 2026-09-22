import { Module } from '@nestjs/common';
import { CarritoService } from './carrito.service';
import { PedidosService } from './pedidos.service';
import { FlujoPedidosService } from './flujo-pedidos.service';
import { CarritoController } from './carrito.controller';
import { PedidosController } from './pedidos.controller';
import { AdminPedidosController } from './admin-pedidos.controller';
import { OperacionesController } from './operaciones.controller';

@Module({
  controllers: [
    CarritoController,
    AdminPedidosController,
    OperacionesController,
    PedidosController,
  ],
  providers: [CarritoService, PedidosService, FlujoPedidosService],
  exports: [CarritoService, PedidosService, FlujoPedidosService],
})
export class PedidosModule {}
