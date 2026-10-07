import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Tienda } from '@prisma/client';
import { TiendasService } from './tiendas.service';
import { GuardarTiendaDto } from './dto/tienda.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';

/**
 * Configuracion -> Tiendas: nombre, direccion y persona responsable.
 *
 * No hay `DELETE` a proposito: de una tienda cuelgan sus transferencias y su
 * inventario. Se retira apagando `activa`.
 */
@ApiTags('Administración · Configuración')
@ApiBearerAuth()
@Controller('admin/configuracion/tiendas')
@RequiereSeccion('configuracion')
export class AdminTiendasController {
  constructor(private readonly tiendas: TiendasService) {}

  @Get()
  listar(): Promise<Tienda[]> {
    return this.tiendas.listar();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  crear(@Body() dto: GuardarTiendaDto): Promise<Tienda> {
    return this.tiendas.crear(dto);
  }

  @Patch(':id')
  actualizar(@Param('id') id: string, @Body() dto: GuardarTiendaDto): Promise<Tienda> {
    return this.tiendas.actualizar(id, dto);
  }
}
