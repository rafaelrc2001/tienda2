import { Module } from '@nestjs/common';
import { AdminMenuController } from './admin-menu.controller';
import { SeccionesPendientesController } from './secciones-pendientes.controller';

@Module({
  controllers: [AdminMenuController, SeccionesPendientesController],
})
export class AdminModule {}
