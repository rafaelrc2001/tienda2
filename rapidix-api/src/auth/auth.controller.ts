import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService, TokenResponse } from './auth.service';
import { StaffLoginDto } from './dto/staff-login.dto';
import { SolicitarCodigoDto, VerificarCodigoDto } from './dto/cliente-login.dto';
import { Public } from './public.decorator';
import { UsuarioActual } from './usuario-actual.decorator';
import { UsuarioAutenticado } from './jwt-payload';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Login del personal del negocio. */
  @Public()
  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  loginStaff(@Body() dto: StaffLoginDto): Promise<TokenResponse> {
    return this.auth.loginStaff(dto);
  }

  /** Paso 1 del login de cliente: manda el codigo por WhatsApp (HU-C02). */
  @Public()
  @Post('cliente/solicitar-codigo')
  @HttpCode(HttpStatus.OK)
  solicitarCodigo(@Body() dto: SolicitarCodigoDto): Promise<{ enviado: true; expiraEnMinutos: number }> {
    return this.auth.solicitarCodigo(dto);
  }

  /** Paso 2 del login de cliente: verifica el codigo y da de alta si es nuevo (HU-C03). */
  @Public()
  @Post('cliente/verificar-codigo')
  @HttpCode(HttpStatus.OK)
  verificarCodigo(@Body() dto: VerificarCodigoDto): Promise<TokenResponse & { esNuevo: boolean; cuponesNuevos: number }> {
    return this.auth.verificarCodigo(dto);
  }

  /** Devuelve quien eres segun el token. Sirve para probar el guard. */
  @Get('yo')
  yo(@UsuarioActual() usuario: UsuarioAutenticado): UsuarioAutenticado {
    return usuario;
  }
}
