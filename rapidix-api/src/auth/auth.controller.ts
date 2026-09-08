import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  AuthService,
  demoLoginActivo,
  RespuestaSolicitarCodigo,
  TokenResponse,
} from './auth.service';
import { StaffLoginDto } from './dto/staff-login.dto';
import { SolicitarCodigoDto, VerificarCodigoDto } from './dto/cliente-login.dto';
import { EntrarDirectoDto } from './dto/demo-login.dto';
import { Public } from './public.decorator';
import { UsuarioActual } from './usuario-actual.decorator';
import { UsuarioAutenticado } from './jwt-payload';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Que modos de acceso ofrece esta API.
   *
   * La pantalla de login lo consulta al abrirse para saber si tiene que
   * enseñar las cinco tarjetas de acceso directo o el login de verdad.
   */
  @Public()
  @Get('modo')
  modo(): { demoLogin: boolean } {
    return { demoLogin: demoLoginActivo() };
  }

  /**
   * Acceso directo por rol, sin credenciales (`AUTH_DEMO_LOGIN`).
   *
   * Simula a n8n, que identifica al cliente por su WhatsApp antes de abrir la
   * app. Responde 403 con la variable apagada.
   */
  @Public()
  @Post('demo/entrar')
  @HttpCode(HttpStatus.OK)
  entrarDirecto(@Body() dto: EntrarDirectoDto): Promise<TokenResponse> {
    return this.auth.entrarDirecto(dto.rol);
  }

  /** Login del personal del negocio. */
  @Public()
  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  loginStaff(@Body() dto: StaffLoginDto): Promise<TokenResponse> {
    return this.auth.loginStaff(dto);
  }

  /**
   * Paso 1 del login de cliente: manda el codigo por WhatsApp (HU-C02).
   *
   * Con `AUTH_OTP_BYPASS=true` no manda nada y devuelve el codigo en
   * `codigoAutomatico` para que el frontend siga de largo.
   */
  @Public()
  @Post('cliente/solicitar-codigo')
  @HttpCode(HttpStatus.OK)
  solicitarCodigo(@Body() dto: SolicitarCodigoDto): Promise<RespuestaSolicitarCodigo> {
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
