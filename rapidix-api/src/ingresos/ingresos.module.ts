import { Module } from '@nestjs/common';
import { IngresosService } from './ingresos.service';
import { AdminIngresosController } from './admin-ingresos.controller';

/**
 * El libro de ingresos. Lo exporta para quien acepta dinero: Rutas, al aceptar
 * el de una entrega o un abono, y Pedidos, al cobrar una cuenta por cobrar.
 */
@Module({
  controllers: [AdminIngresosController],
  providers: [IngresosService],
  exports: [IngresosService],
})
export class IngresosModule {}
