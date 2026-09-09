import { Global, Module } from '@nestjs/common';
import { InventarioService } from './inventario.service';
import { AdminInventarioController } from './admin-inventario.controller';

/** Global: la transaccion del pedido descuenta lo vendido. */
@Global()
@Module({
  controllers: [AdminInventarioController],
  providers: [InventarioService],
  exports: [InventarioService],
})
export class InventarioModule {}
