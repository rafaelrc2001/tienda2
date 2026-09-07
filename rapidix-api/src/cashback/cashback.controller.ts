import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { CashbackService, EstadoCashback, MovimientoDto } from './cashback.service';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { ROL_CLIENTE, UsuarioAutenticado } from '../auth/jwt-payload';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Cashback')
@ApiBearerAuth()
@Controller('perfil/cashback')
export class CashbackController {
  constructor(private readonly cashback: CashbackService) {}

  /** Tarjeta de Cashback: saldo, nivel y progreso (Word 4.7). */
  @Get()
  estado(@UsuarioActual() usuario: UsuarioAutenticado): Promise<EstadoCashback> {
    if (usuario.rol !== ROL_CLIENTE) {
      throw new ForbiddenException('Esta sección es exclusiva para clientes.');
    }
    return this.cashback.estado(usuario.sub);
  }

  /** "Ver estado de cuenta". */
  @Get('movimientos')
  movimientos(@UsuarioActual() usuario: UsuarioAutenticado): Promise<MovimientoDto[]> {
    if (usuario.rol !== ROL_CLIENTE) {
      throw new ForbiddenException('Esta sección es exclusiva para clientes.');
    }
    return this.cashback.movimientos(usuario.sub);
  }
}
