import { Module } from '@nestjs/common';
import { CatalogoService } from './catalogo.service';
import { ImportacionService } from './importacion.service';
import { CatalogoController } from './catalogo.controller';
import { AdminProductosController } from './admin-productos.controller';
import { AdminImportacionController } from './admin-importacion.controller';

@Module({
  // AdminImportacionController va antes que AdminProductosController para que
  // GET /admin/productos/plantilla no lo capture la ruta GET :id.
  controllers: [CatalogoController, AdminImportacionController, AdminProductosController],
  providers: [CatalogoService, ImportacionService],
  exports: [CatalogoService],
})
export class CatalogoModule {}
