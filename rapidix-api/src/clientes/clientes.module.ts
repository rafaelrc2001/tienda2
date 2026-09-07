import { Module } from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { ClientesController } from './clientes.controller';
import { AdminClientesController } from './admin-clientes.controller';

@Module({
  controllers: [ClientesController, AdminClientesController],
  providers: [ClientesService],
  exports: [ClientesService],
})
export class ClientesModule {}
