import { Global, Module } from '@nestjs/common';
import { CashbackService } from './cashback.service';
import { CashbackController } from './cashback.controller';
import { AdminNivelesController } from './admin-niveles.controller';

/** Global: la transaccion del pedido acredita cashback. */
@Global()
@Module({
  controllers: [AdminNivelesController, CashbackController],
  providers: [CashbackService],
  exports: [CashbackService],
})
export class CashbackModule {}
