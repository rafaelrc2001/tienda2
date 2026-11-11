import { Module } from '@nestjs/common';
import { FacturacionModule } from '../facturacion/facturacion.module';
import { TiendasModule } from '../tiendas/tiendas.module';
import { CatalogoService } from './catalogo.service';
import { CategoriasService } from './categorias.service';
import { RecomendacionesService } from './recomendaciones.service';
import { ImportacionService } from './importacion.service';
import { CatalogoController } from './catalogo.controller';
import { AdminProductosController } from './admin-productos.controller';
import { AdminImportacionController } from './admin-importacion.controller';
import { AdminCategoriasController } from './admin-categorias.controller';

@Module({
  // Los catalogos del SAT validan las claves que se le ponen a un producto.
  // Tiendas da las existencias de cada sucursal: quien recoge en tienda ve
  // el anaquel de esa tienda, no la bodega.
  imports: [FacturacionModule, TiendasModule],
  // AdminImportacionController va antes que AdminProductosController para que
  // GET /admin/productos/plantilla no lo capture la ruta GET :id.
  controllers: [
    CatalogoController,
    AdminCategoriasController,
    AdminImportacionController,
    AdminProductosController,
  ],
  providers: [CatalogoService, CategoriasService, ImportacionService, RecomendacionesService],
  exports: [CatalogoService, CategoriasService, RecomendacionesService],
})
export class CatalogoModule {}
