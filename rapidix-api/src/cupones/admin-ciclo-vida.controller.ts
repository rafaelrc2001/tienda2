import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CicloVidaService, TipoCicloVidaDto } from './ciclo-vida.service';
import { ActualizarCicloVidaDto, CambiarActivoDto } from './dto/ciclo-vida.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

/**
 * Administracion -> Configuracion -> Cupones -> Ciclo de vida.
 * Vive bajo la seccion `configuracion` (Word 4.9).
 */
@ApiTags('Administración · Cupones')
@ApiBearerAuth()
@Controller('admin/cupones/ciclo-vida')
@RequiereSeccion('configuracion')
export class AdminCicloVidaController {
  constructor(private readonly cicloVida: CicloVidaService) {}

  @Get()
  listar(): Promise<TipoCicloVidaDto[]> {
    return this.cicloVida.listar();
  }

  @Patch(':code')
  actualizar(
    @Param('code') code: string,
    @Body() dto: ActualizarCicloVidaDto,
  ): Promise<TipoCicloVidaDto> {
    return this.cicloVida.actualizar(code, dto);
  }

  @Patch(':code/activo')
  cambiarActivo(
    @Param('code') code: string,
    @Body() dto: CambiarActivoDto,
  ): Promise<TipoCicloVidaDto> {
    return this.cicloVida.cambiarActivo(code, dto.isActive);
  }

  /**
   * Emite manualmente una instancia al cliente indicado, para pruebas de QA.
   * En el prototipo el destinatario era "el cliente con sesion activa"; aqui
   * el administrador lo indica explicitamente.
   */
  @Post(':code/emitir-prueba')
  @HttpCode(HttpStatus.OK)
  emitirDePrueba(
    @Param('code') code: string,
    @Query('clienteId') clienteId?: string,
  ): Promise<{ code: string }> {
    if (!clienteId) {
      throw new BadRequestException('Indica el clienteId al que emitir el cupón de prueba.');
    }
    return this.cicloVida.emitirDePrueba(code, clienteId);
  }
}
