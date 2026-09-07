import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CampaniaDto, CampaniasService } from './campanias.service';
import { GuardarCampaniaDto } from './dto/campania.dto';
import { CambiarActivoDto } from './dto/ciclo-vida.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

/** Administracion -> Configuracion -> Cupones -> Campanas (Word 4.9.2). */
@ApiTags('Administración · Cupones')
@ApiBearerAuth()
@Controller('admin/cupones/campanias')
@RequiereSeccion('configuracion')
export class AdminCampaniasController {
  constructor(private readonly campanias: CampaniasService) {}

  @Get()
  listar(): Promise<CampaniaDto[]> {
    return this.campanias.listar();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  crear(@Body() dto: GuardarCampaniaDto): Promise<CampaniaDto> {
    return this.campanias.crear(dto);
  }

  @Patch(':id')
  actualizar(@Param('id') id: string, @Body() dto: GuardarCampaniaDto): Promise<CampaniaDto> {
    return this.campanias.actualizar(id, dto);
  }

  @Patch(':id/activo')
  cambiarActivo(@Param('id') id: string, @Body() dto: CambiarActivoDto): Promise<CampaniaDto> {
    return this.campanias.cambiarActivo(id, dto.isActive);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  eliminar(@Param('id') id: string): Promise<void> {
    return this.campanias.eliminar(id);
  }

  @Post(':id/emitir-prueba')
  @HttpCode(HttpStatus.OK)
  emitirDePrueba(
    @Param('id') id: string,
    @Query('clienteId') clienteId?: string,
  ): Promise<{ code: string }> {
    if (!clienteId) {
      throw new BadRequestException('Indica el clienteId al que emitir el cupón de prueba.');
    }
    return this.campanias.emitirDePrueba(id, clienteId);
  }
}
