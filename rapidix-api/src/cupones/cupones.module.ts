import { Global, Module } from '@nestjs/common';
import { CuponesService } from './cupones.service';
import { CicloVidaService } from './ciclo-vida.service';
import { CampaniasService } from './campanias.service';
import { FuentesService } from './fuentes.service';
import { MetricasService } from './metricas.service';
import { ExpiracionService } from './expiracion.service';
import { CuponesController } from './cupones.controller';
import { AdminCicloVidaController } from './admin-ciclo-vida.controller';
import { AdminCampaniasController } from './admin-campanias.controller';
import { AdminFuentesController } from './admin-fuentes.controller';

/** Global: Auth (login) y Pedidos (checkout) disparan emisiones. */
@Global()
@Module({
  controllers: [
    AdminCicloVidaController,
    AdminCampaniasController,
    AdminFuentesController,
    CuponesController,
  ],
  providers: [
    CuponesService,
    CicloVidaService,
    CampaniasService,
    FuentesService,
    MetricasService,
    ExpiracionService,
  ],
  exports: [CuponesService, CicloVidaService, CampaniasService, FuentesService, MetricasService],
})
export class CuponesModule {}
