import { Module } from '@nestjs/common';
import { FacturacionController } from './facturacion.controller';
import { FacturacionService } from './facturacion.service';
import { AdminCatalogoSatController } from './admin-catalogo-sat.controller';
import { CatalogoSatService } from './catalogo-sat.service';

/**
 * CFDI 4.0 con factura.com, o simulado sin llaves. El proveedor se elige solo
 * al arrancar segun las variables `FACTURACOM_*` (ver `timbrador-factura-com.ts`).
 *
 * Exporta los catalogos del SAT: el catalogo de productos los usa para validar
 * las claves que se le asignan a cada producto.
 */
@Module({
  controllers: [FacturacionController, AdminCatalogoSatController],
  providers: [FacturacionService, CatalogoSatService],
  exports: [CatalogoSatService],
})
export class FacturacionModule {}
