import { Module } from '@nestjs/common';
import { CarritoService } from './carrito.service';
import { PedidosService } from './pedidos.service';
import { CarritoController } from './carrito.controller';
import { PedidosController } from './pedidos.controller';
import { AdminPedidosController } from './admin-pedidos.controller';

@Module({
  controllers: [CarritoController, AdminPedidosController, PedidosController],
  providers: [CarritoService, PedidosService],
  exports: [CarritoService, PedidosService],
})
export class PedidosModule {}
