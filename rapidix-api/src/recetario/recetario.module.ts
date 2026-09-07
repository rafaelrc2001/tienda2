import { Module } from '@nestjs/common';
import { RecetarioService } from './recetario.service';
import { RecetarioClienteService } from './recetario-cliente.service';
import { BloqueoInactividadService } from './bloqueo-inactividad.service';
import { RecetarioController } from './recetario.controller';
import { RecetarioClienteController } from './recetario-cliente.controller';
import { AdminRecetasController } from './admin-recetas.controller';

@Module({
  // Las rutas concretas (/recetario/..., /recetas/:id/guardar) van antes que
  // RecetarioController, cuyo GET :id capturaria cualquier segmento.
  controllers: [AdminRecetasController, RecetarioClienteController, RecetarioController],
  providers: [RecetarioService, RecetarioClienteService, BloqueoInactividadService],
  exports: [RecetarioService, RecetarioClienteService, BloqueoInactividadService],
})
export class RecetarioModule {}
