import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Destacados, DestacadosService } from './destacados.service';
import { ConfiguracionPublica, ConfiguracionService } from './configuracion.service';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Destacados')
@ApiBearerAuth()
@Controller()
export class DestacadosController {
  constructor(
    private readonly destacados: DestacadosService,
    private readonly configuracion: ConfiguracionService,
  ) {}

  @Get('destacados')
  ver(@UsuarioActual() usuario: UsuarioAutenticado): Promise<Destacados> {
    return this.destacados.ver(usuario);
  }

  /** Se llama al abrir la seccion: limpia la insignia de no leidos. */
  @Post('destacados/leido')
  @HttpCode(HttpStatus.OK)
  marcarLeido(@UsuarioActual() usuario: UsuarioAutenticado): Promise<{ noLeidos: 0 }> {
    return this.destacados.marcarLeido(usuario);
  }

  /** Horario, envio y datos de pago que la app del cliente necesita mostrar. */
  @Get('configuracion')
  configuracionPublica(): Promise<ConfiguracionPublica> {
    return this.configuracion.verPublica();
  }
}
