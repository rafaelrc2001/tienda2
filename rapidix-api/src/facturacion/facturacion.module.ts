import { Module } from '@nestjs/common';
import { TiendasModule } from '../tiendas/tiendas.module';
import { FacturacionController } from './facturacion.controller';
import { FacturacionService } from './facturacion.service';
import { AdminCatalogoSatController } from './admin-catalogo-sat.controller';
import { AdminFacturacionController } from './admin-facturacion.controller';
import { CatalogoSatService } from './catalogo-sat.service';
import { AdminFacturaGlobalController } from './admin-factura-global.controller';
import { FacturaGlobalService } from './factura-global.service';
import { AdminFacturasController } from './admin-facturas.controller';
import { FacturasEmitidasService } from './facturas-emitidas.service';
import { AdminEmisorController } from './admin-emisor.controller';
import { EmisorService } from './emisor.service';
import { PdvFacturacionController } from './pdv-facturacion.controller';
import { FacturacionPdvService } from './facturacion-pdv.service';

/**
 * CFDI 4.0 con factura.com, o simulado sin llaves. Un solo emisor: la cuenta
 * de factura.com de las variables `FACTURACOM_*`, con sus datos fiscales
 * leidos de ella (ver `emisor.service.ts`).
 *
 * Exporta los catalogos del SAT: el catalogo de productos los usa para validar
 * las claves que se le asignan a cada producto. Importa `TiendasModule` porque
 * el punto de venta solo factura los pedidos de las tiendas de quien entra.
 */
@Module({
  imports: [TiendasModule],
  controllers: [
    FacturacionController,
    AdminCatalogoSatController,
    AdminFacturacionController,
    AdminFacturaGlobalController,
    AdminFacturasController,
    AdminEmisorController,
    PdvFacturacionController,
  ],
  providers: [
    FacturacionService,
    CatalogoSatService,
    FacturaGlobalService,
    FacturasEmitidasService,
    EmisorService,
    FacturacionPdvService,
  ],
  exports: [CatalogoSatService],
})
export class FacturacionModule {}
