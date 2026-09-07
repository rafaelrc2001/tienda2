import { Global, Module } from '@nestjs/common';
import { ConfiguracionService } from './configuracion.service';
import { DestacadosService } from './destacados.service';
import { AdminConfiguracionController } from './admin-configuracion.controller';
import { DestacadosController } from './destacados.controller';

/**
 * Global porque Pedidos y Cashback necesitan la configuracion del negocio
 * (costo de envio, envio gratis, recargo fuera de horario, cashback).
 */
@Global()
@Module({
  controllers: [AdminConfiguracionController, DestacadosController],
  providers: [ConfiguracionService, DestacadosService],
  exports: [ConfiguracionService, DestacadosService],
})
export class ConfiguracionModule {}
