import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { CuentaBancaria } from '@prisma/client';
import {
  BancariosResponse,
  ConfiguracionService,
  FiscalResponse,
  HorarioResponse,
  ParametrosResponse,
} from './configuracion.service';
import { DestacadosService } from './destacados.service';
import {
  AvisoDto,
  BancariosDto,
  CuentaBancariaDto,
  FiscalDto,
  HorarioDto,
  NoticiaDto,
  ParametrosDto,
} from './dto/configuracion.dto';
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

  // ---- Cuentas bancarias (dentro de Datos bancarios) ----

  @Get('cuentas-bancarias')
  listarCuentasBancarias(): Promise<CuentaBancaria[]> {
    return this.configuracion.listarCuentasBancarias();
  }

  @Post('cuentas-bancarias')
  @HttpCode(HttpStatus.CREATED)
  crearCuentaBancaria(@Body() dto: CuentaBancariaDto): Promise<CuentaBancaria> {
    return this.configuracion.crearCuentaBancaria(dto);
  }

  @Delete('cuentas-bancarias/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  eliminarCuentaBancaria(@Param('id') id: string): Promise<void> {
    return this.configuracion.eliminarCuentaBancaria(id);
  }

  // ---- Datos fiscales del negocio ----

  @Get('fiscal')
  verFiscal(): Promise<FiscalResponse> {
    return this.configuracion.verFiscal();
  }

  @Put('fiscal')
  guardarFiscal(@Body() dto: FiscalDto): Promise<FiscalResponse> {
    return this.configuracion.guardarFiscal(dto);
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
