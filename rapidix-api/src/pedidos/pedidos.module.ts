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

@Module({
  controllers: [
    CarritoController,
    AdminPedidosController,
    OperacionesController,
    FinanzasController,
    PedidosController,
  ],
  providers: [CarritoService, PedidosService, FlujoPedidosService, FinanzasService],
  exports: [CarritoService, PedidosService, FlujoPedidosService, FinanzasService],
})
export class PedidosModule {}
