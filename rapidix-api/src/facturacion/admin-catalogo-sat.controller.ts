import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { CatalogoSatService, ClaveProdServ, ClaveUnidad } from './catalogo-sat.service';

export class BuscarClaveSatDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

/**
 * Buscadores de los campos «Clave SAT» y «Clave de unidad» del alta de
 * productos. Van con la seccion de productos: es la unica pantalla que los usa.
 */
@ApiTags('Administración · Productos')
@ApiBearerAuth()
@Controller('admin/sat')
@RequiereSeccion('productos')
export class AdminCatalogoSatController {
  constructor(private readonly catalogo: CatalogoSatService) {}

  @Get('productos-servicios')
  productosServicios(@Query() dto: BuscarClaveSatDto): ClaveProdServ[] {
    return this.catalogo.buscarProductos(dto.q ?? '');
  }

  @Get('unidades')
  unidades(@Query() dto: BuscarClaveSatDto): ClaveUnidad[] {
    return this.catalogo.buscarUnidades(dto.q ?? '');
  }
}
