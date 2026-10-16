import { Module } from '@nestjs/common';
import { FacturacionController } from './facturacion.controller';
import { FacturacionService } from './facturacion.service';

/**
 * CFDI 4.0 con factura.com, o simulado sin llaves. El proveedor se elige solo
 * al arrancar segun las variables `FACTURACOM_*` (ver `timbrador-factura-com.ts`).
 */
@Module({
  controllers: [FacturacionController],
  providers: [FacturacionService],
})
export class FacturacionModule {}
