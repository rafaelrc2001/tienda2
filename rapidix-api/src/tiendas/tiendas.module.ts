import { Module } from '@nestjs/common';
import { TiendasService } from './tiendas.service';
import { TransferenciasService } from './transferencias.service';
import { AdminTiendasController } from './admin-tiendas.controller';
import { AdminTransferenciasController } from './admin-transferencias.controller';
import { PdvController } from './pdv.controller';
import { TiendasController } from './tiendas.controller';

/**
 * Tiendas, su inventario y las transferencias que lo cargan. Cuatro
 * controladores porque son cuatro audiencias: Configuracion las da de alta,
 * Productos les manda mercancia, el PDV la recibe y el cliente elige en cual
 * recoge su pedido.
 *
 * `InventarioModule` es global: de ahi sale `InventarioService`.
 */
@Module({
  controllers: [
    AdminTiendasController,
    AdminTransferenciasController,
    PdvController,
    TiendasController,
  ],
  providers: [TiendasService, TransferenciasService],
  exports: [TiendasService],
})
export class TiendasModule {}
