import { Module } from '@nestjs/common';
import { AdminBancosController } from './admin-bancos.controller';
import { BancosService } from './bancos.service';

/** Finanzas -> Bancos: periodos y movimientos de las cuentas bancarias del negocio. */
@Module({
  controllers: [AdminBancosController],
  providers: [BancosService],
})
export class BancosModule {}
