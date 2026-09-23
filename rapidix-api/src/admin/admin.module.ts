import { Module } from '@nestjs/common';
import { AdminMenuController } from './admin-menu.controller';

@Module({
  controllers: [AdminMenuController],
})
export class AdminModule {}
