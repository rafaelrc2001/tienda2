import { Module } from '@nestjs/common';
import { PedidosModule } from '../pedidos/pedidos.module';
import { RutasService } from './rutas.service';
import { RutasController } from './rutas.controller';

/**
 * Rutas vive aparte de Pedidos aunque mueva pedidos: lo suyo es la jornada, el
 * camion y el corte, y toma prestado de `PedidosModule` lo que ya sabe mover el
 * eje fisico (`FlujoPedidosService`) y leer un pedido (`PedidosService`).
 */
@Module({
  imports: [PedidosModule],
  controllers: [RutasController],
  providers: [RutasService],
  exports: [RutasService],
})
export class RutasModule {}
