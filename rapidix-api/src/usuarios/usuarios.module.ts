import { Module } from '@nestjs/common';
import { AdminUsuariosController } from './admin-usuarios.controller';
import { UsuariosService } from './usuarios.service';

@Module({
  controllers: [AdminUsuariosController],
  providers: [UsuariosService],
})
export class UsuariosModule {}
