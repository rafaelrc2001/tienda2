import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CarritoService, ResultadoCupon } from './carrito.service';
import { ValidarCuponDto } from './dto/carrito.dto';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { ROL_CLIENTE, UsuarioAutenticado } from '../auth/jwt-payload';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Carrito')
@ApiBearerAuth()
@Controller('carrito')
export class CarritoController {
  constructor(private readonly carrito: CarritoService) {}

  /**
   * Campo "!Tienes un cupon?" del checkout (Word 6.3).
   *
   * Responde 200 tanto si el cupon vale como si no: un cupon rechazado no es
   * un error de la peticion, es informacion que el cliente necesita ver.
   */
  @Post('validar-cupon')
  @HttpCode(HttpStatus.OK)
  async validarCupon(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: ValidarCuponDto,
  ): Promise<ResultadoCupon> {
    if (usuario.rol !== ROL_CLIENTE) {
      throw new ForbiddenException('Solo un cliente puede aplicar cupones.');
    }
    const carrito = await this.carrito.resolver(dto.items);
    return this.carrito.validarCupon(usuario.sub, dto.codigo, carrito);
  }
}
