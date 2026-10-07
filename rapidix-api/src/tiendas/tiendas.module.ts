import { Module } from '@nestjs/common';
import { TiendasService } from './tiendas.service';
import { TransferenciasService } from './transferencias.service';
import { AdminTiendasController } from './admin-tiendas.controller';
import { AdminTransferenciasController } from './admin-transferencias.controller';
import { PdvController } from './pdv.controller';

/**
 * Tiendas, su inventario y las transferencias que lo cargan. Tres
 * controladores porque son tres audiencias: Configuracion las da de alta,
 * Productos les manda mercancia y el PDV la recibe.
 *
 * `InventarioModule` es global: de ahi sale `InventarioService`.
 */
@Module({
  controllers: [AdminTiendasController, AdminTransferenciasController, PdvController],
  providers: [TiendasService, TransferenciasService],
  exports: [TiendasService],
})
export class TiendasModule {}
