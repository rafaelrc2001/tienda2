import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import {
  BancariosResponse,
  ConfiguracionService,
  HorarioResponse,
  ParametrosResponse,
} from './configuracion.service';
import { DestacadosService } from './destacados.service';
import { AvisoDto, BancariosDto, HorarioDto, NoticiaDto, ParametrosDto } from './dto/configuracion.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Administración · Configuración')
@ApiBearerAuth()
@Controller('admin/configuracion')
@RequiereSeccion('configuracion')
export class AdminConfiguracionController {
  constructor(
    private readonly configuracion: ConfiguracionService,
    private readonly destacados: DestacadosService,
  ) {}

  // ---- Horario de servicio (HU-A04) ----

  @Get('horario')
  verHorario(): Promise<HorarioResponse> {
    return this.configuracion.verHorario();
  }

  @Put('horario')
  guardarHorario(@Body() dto: HorarioDto): Promise<HorarioResponse> {
    return this.configuracion.guardarHorario(dto);
  }

  // ---- Parametros del negocio (HU-A05) ----

  @Get('parametros')
  verParametros(): Promise<ParametrosResponse> {
    return this.configuracion.verParametros();
  }

  @Put('parametros')
  guardarParametros(@Body() dto: ParametrosDto): Promise<ParametrosResponse> {
    return this.configuracion.guardarParametros(dto);
  }

  // ---- Datos bancarios (HU-A06) ----

  @Get('bancarios')
  verBancarios(): Promise<BancariosResponse> {
    return this.configuracion.verBancarios();
  }

  @Put('bancarios')
  guardarBancarios(@Body() dto: BancariosDto): Promise<BancariosResponse> {
    return this.configuracion.guardarBancarios(dto);
  }

  // ---- Noticias y avisos (HU-A07) ----

  @Post('noticias')
  @HttpCode(HttpStatus.CREATED)
  publicarNoticia(@Body() dto: NoticiaDto) {
    return this.destacados.publicarNoticia(dto);
  }

  @Delete('noticias/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  eliminarNoticia(@Param('id') id: string): Promise<void> {
    return this.destacados.eliminarNoticia(id);
  }

  @Post('avisos')
  @HttpCode(HttpStatus.CREATED)
  publicarAviso(@Body() dto: AvisoDto) {
    return this.destacados.publicarAviso(dto);
  }

  @Delete('avisos/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  eliminarAviso(@Param('id') id: string): Promise<void> {
    return this.destacados.eliminarAviso(id);
  }
}
