import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AutenticacionOpcional } from '../auth/auth-opcional.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { LoteDiagnosticoDto } from './dto/diagnostico.dto';

/**
 * TEMPORAL: recibe la telemetria de la sonda de la Tienda para depurar el
 * importe encimado de «Comprar ahora» en Safari iOS. Token opcional: la Tienda
 * se puede mirar sin sesion y el fallo tambien hay que verlo ahi.
 *
 * Se borra (modulo, modelo y tabla) cuando se cierre el caso.
 */
@ApiTags('Diagnostico (temporal)')
@Controller('diagnostico-ui')
export class DiagnosticoController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @HttpCode(204)
  @AutenticacionOpcional()
  async registrar(
    @Body() lote: LoteDiagnosticoDto,
    @Headers('user-agent') userAgent: string | undefined,
    @UsuarioActual() usuario?: UsuarioAutenticado,
  ): Promise<void> {
    await this.prisma.diagnosticoUi.createMany({
      data: lote.eventos.map((e) => ({
        sesion: lote.sesion,
        evento: e.evento,
        usuarioId: usuario?.sub ?? null,
        userAgent: userAgent?.slice(0, 400) ?? null,
        datos: e.datos as Prisma.InputJsonValue,
      })),
    });
  }
}
