import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import {
  BancosService,
  CuentaBancoDto,
  EstadoCuentaDto,
  PeriodoBancarioDto,
} from './bancos.service';
import { AbrirPeriodoDto, NuevoMovimientoDto } from './dto/bancos.dto';

/**
 * Administracion -> Finanzas -> Bancos: el estado de cuenta de cada cuenta
 * bancaria, mes por mes.
 *
 * Las cuentas se dan de alta en Configuracion; aqui se leen desde la seccion
 * de Finanzas, porque el rol FINANZAS no ve Configuracion.
 */
@ApiTags('Administración · Finanzas')
@ApiBearerAuth()
@Controller('admin/finanzas/bancos')
@RequiereSeccion('finanzas')
export class AdminBancosController {
  constructor(private readonly bancos: BancosService) {}

  @Get('cuentas')
  listarCuentas(): Promise<CuentaBancoDto[]> {
    return this.bancos.listarCuentas();
  }

  /** Los periodos de la cuenta y el mes que toca abrir, con su saldo inicial. */
  @Get('cuentas/:id')
  estadoDeCuenta(@Param('id') id: string): Promise<EstadoCuentaDto> {
    return this.bancos.estadoDeCuenta(id);
  }

  @Post('cuentas/:id/periodos')
  @HttpCode(HttpStatus.CREATED)
  abrirPeriodo(
    @Param('id') id: string,
    @Body() dto: AbrirPeriodoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PeriodoBancarioDto> {
    return this.bancos.abrirPeriodo(id, dto, usuario.sub);
  }

  @Get('periodos/:id')
  verPeriodo(@Param('id') id: string): Promise<PeriodoBancarioDto> {
    return this.bancos.verPeriodo(id);
  }

  @Post('periodos/:id/movimientos')
  @HttpCode(HttpStatus.CREATED)
  agregarMovimiento(
    @Param('id') id: string,
    @Body() dto: NuevoMovimientoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PeriodoBancarioDto> {
    return this.bancos.agregarMovimiento(id, dto, usuario.sub);
  }

  /** Devuelve el periodo como queda, con su saldo ya recalculado. */
  @Delete('movimientos/:id')
  eliminarMovimiento(@Param('id') id: string): Promise<PeriodoBancarioDto> {
    return this.bancos.eliminarMovimiento(id);
  }
}
