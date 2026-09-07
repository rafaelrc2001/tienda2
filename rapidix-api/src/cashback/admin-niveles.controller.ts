import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { NivelFidelidad } from '@prisma/client';
import { CashbackService } from './cashback.service';
import { GuardarNivelDto } from './dto/nivel.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

/**
 * Niveles de fidelidad. No existen en el Word ni en el prototipo —alli
 * Bronce y Plata estan escritos a mano—, asi que se configuran aqui en vez
 * de volver a fijarlos en el codigo. Los valores del seed son provisionales.
 */
@ApiTags('Administración · Configuración')
@ApiBearerAuth()
@Controller('admin/configuracion/niveles')
@RequiereSeccion('configuracion')
export class AdminNivelesController {
  constructor(private readonly cashback: CashbackService) {}

  @Get()
  listar(): Promise<NivelFidelidad[]> {
    return this.cashback.listarNiveles();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  crear(@Body() dto: GuardarNivelDto): Promise<NivelFidelidad> {
    return this.cashback.crearNivel(dto);
  }

  @Patch(':id')
  actualizar(@Param('id') id: string, @Body() dto: GuardarNivelDto): Promise<NivelFidelidad> {
    return this.cashback.actualizarNivel(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  eliminar(@Param('id') id: string): Promise<void> {
    return this.cashback.eliminarNivel(id);
  }
}
