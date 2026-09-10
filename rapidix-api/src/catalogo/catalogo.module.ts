import { Module } from '@nestjs/common';
import { CatalogoService } from './catalogo.service';
import { CategoriasService } from './categorias.service';
import { RecomendacionesService } from './recomendaciones.service';
import { ImportacionService } from './importacion.service';
import { CatalogoController } from './catalogo.controller';
import { AdminProductosController } from './admin-productos.controller';
import { AdminImportacionController } from './admin-importacion.controller';
import { AdminCategoriasController } from './admin-categorias.controller';

@Module({
  // AdminImportacionController va antes que AdminProductosController para que
  // GET /admin/productos/plantilla no lo capture la ruta GET :id.
  controllers: [
    CatalogoController,
    AdminCategoriasController,
    AdminImportacionController,
    AdminProductosController,
  ],
  providers: [CatalogoService, CategoriasService, ImportacionService, RecomendacionesService],
  exports: [CatalogoService, CategoriasService],
})
export class CatalogoModule {}
