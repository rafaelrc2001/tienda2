import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { FuenteDto, FuentesService } from './fuentes.service';
import { MetricasCupones, MetricasService } from './metricas.service';
import { ExpiracionService } from './expiracion.service';
import { GuardarFuenteDto } from './dto/fuente.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

/** Administracion -> Configuracion -> Cupones -> Fuentes y Metricas. */
@ApiTags('Administración · Cupones')
@ApiBearerAuth()
@Controller('admin/cupones')
@RequiereSeccion('configuracion')
export class AdminFuentesController {
  constructor(
    private readonly fuentes: FuentesService,
    private readonly metricas: MetricasService,
    private readonly expiracion: ExpiracionService,
  ) {}

  @Get('fuentes')
  listar(): Promise<FuenteDto[]> {
    return this.fuentes.listar();
  }

  @Post('fuentes')
  @HttpCode(HttpStatus.CREATED)
  crear(@Body() dto: GuardarFuenteDto): Promise<FuenteDto> {
    return this.fuentes.crear(dto);
  }

  @Patch('fuentes/:id')
  actualizar(@Param('id') id: string, @Body() dto: GuardarFuenteDto): Promise<FuenteDto> {
    return this.fuentes.actualizar(id, dto);
  }

  @Delete('fuentes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  eliminar(@Param('id') id: string): Promise<void> {
    return this.fuentes.eliminar(id);
  }

  /** Metricas del motor de cupones, calculadas en vivo (Word 4.9.5). */
  @Get('metricas')
  verMetricas(): Promise<MetricasCupones> {
    return this.metricas.calcular();
  }

  /**
   * Ejecuta el barrido de vencimientos a mano. El job corre solo cada dia a
   * las 3:00; esto existe para poder verificarlo sin esperar.
   */
  @Post('expirar-vencidos')
  @HttpCode(HttpStatus.OK)
  expirarVencidos(): Promise<{ expirados: number }> {
    return this.expiracion.expirarVencidos();
  }
}
