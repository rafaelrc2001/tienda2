import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  CarritoService,
  PrevisualizacionCarritoDto,
  ResultadoCupon,
  SubtotalCarritoDto,
} from './carrito.service';
import { LineasCarritoDto, PrevisualizarCarritoDto, ValidarCuponDto } from './dto/carrito.dto';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { Public } from '../auth/public.decorator';
import { ROL_CLIENTE, UsuarioAutenticado } from '../auth/jwt-payload';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Carrito')
@ApiBearerAuth()
@Controller('carrito')
export class CarritoController {
  constructor(private readonly carrito: CarritoService) {}

  /**
   * Desglose del carrito antes de confirmar.
   *
   * La interfaz no repite ni una regla de envio, recargo o cashback: las pide.
   * Responde 200 aunque el carrito no se pueda pedir todavia; el motivo viaja
   * en `avisos` y en `puedePedir`.
   */
  @Post('previsualizar')
  @HttpCode(HttpStatus.OK)
  previsualizar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: PrevisualizarCarritoDto,
  ): Promise<PrevisualizacionCarritoDto> {
    if (usuario.rol !== ROL_CLIENTE) {
      throw new ForbiddenException('Solo un cliente puede armar un carrito.');
    }
    return this.carrito.previsualizar(usuario.sub, dto);
  }

  /**
   * Lo que suman los productos del carrito, para el boton flotante de la
   * Tienda (HU-11).
   *
   * Es publico porque el visitante sin sesion tambien arma su carrito antes de
   * decidir si entra (HU-14), y no expone nada que no este ya en el catalogo:
   * responde con precios de productos, sin tocar cupones ni cashback ni saber
   * quien pregunta.
   */
  @Post('subtotal')
  @Public()
  @HttpCode(HttpStatus.OK)
  subtotal(@Body() dto: LineasCarritoDto): Promise<SubtotalCarritoDto> {
    return this.carrito.subtotalDe(dto.items);
  }

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
