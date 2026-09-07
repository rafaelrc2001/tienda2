import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomInt } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFICATION_SENDER, NotificationSender } from '../notifications/notification-sender';
import { CuponesService } from '../cupones/cupones.service';
import { CampaniasService } from '../cupones/campanias.service';
import { FuentesService } from '../cupones/fuentes.service';
import { StaffLoginDto } from './dto/staff-login.dto';
import { SolicitarCodigoDto, VerificarCodigoDto } from './dto/cliente-login.dto';
import { JwtPayload, ROL_CLIENTE, RolToken } from './jwt-payload';

export interface TokenResponse {
  accessToken: string;
  rol: RolToken;
  nombre: string;
}

/** Parametros del OTP. Fijos: el Word no los deja configurables. */
const OTP_VIGENCIA_MINUTOS = 5;
const OTP_MAX_INTENTOS = 5;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(NOTIFICATION_SENDER) private readonly notificaciones: NotificationSender,
    private readonly cupones: CuponesService,
    private readonly campanias: CampaniasService,
    private readonly fuentes: FuentesService,
  ) {}

  static hashPassword(plano: string): Promise<string> {
    return argon2.hash(plano, { type: argon2.argon2id });
  }

  /** Deja solo digitos y el + inicial, para que el telefono sea comparable. */
  static normalizarTelefono(telefono: string): string {
    const soloDigitos = telefono.replace(/[^\d]/g, '');
    return telefono.trim().startsWith('+') ? `+${soloDigitos}` : soloDigitos;
  }

  // ----------------------------------------------------------------
  // Staff
  // ----------------------------------------------------------------

  /**
   * Login del personal (Administrador, Ruta, Operaciones, Finanzas).
   *
   * El mensaje de error es el mismo para "email inexistente", "contrasena
   * incorrecta" y "usuario desactivado": no se le dice a un atacante cual de
   * los tres fallo.
   */
  async loginStaff(dto: StaffLoginDto): Promise<TokenResponse> {
    const email = dto.email.trim().toLowerCase();
    const usuario = await this.prisma.usuario.findUnique({ where: { email } });

    // Se verifica siempre contra un hash, exista o no el usuario, para que el
    // tiempo de respuesta no revele si el email esta dado de alta.
    const hash = usuario?.passwordHash ?? AuthService.HASH_SENUELO;
    const passwordValida = await argon2.verify(hash, dto.password).catch(() => false);

    if (!usuario || !usuario.activo || !passwordValida) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    return this.firmarToken({ sub: usuario.id, rol: usuario.rol, nombre: usuario.nombre });
  }

  // ----------------------------------------------------------------
  // Cliente (OTP por WhatsApp)
  // ----------------------------------------------------------------

  /**
   * Genera un codigo de 6 digitos y lo envia por WhatsApp (HU-C02).
   *
   * La respuesta es siempre la misma exista o no el telefono: la pantalla de
   * login del prototipo no distingue entre cliente nuevo y recurrente hasta
   * despues de verificar el codigo.
   */
  async solicitarCodigo(dto: SolicitarCodigoDto): Promise<{ enviado: true; expiraEnMinutos: number }> {
    const telefono = AuthService.normalizarTelefono(dto.telefono);
    const codigo = randomInt(0, 1_000_000).toString().padStart(6, '0');

    // Un solo codigo vivo por telefono: pedir uno nuevo invalida el anterior.
    await this.prisma.codigoOtp.updateMany({
      where: { telefono, consumidoEn: null },
      data: { consumidoEn: new Date() },
    });

    await this.prisma.codigoOtp.create({
      data: {
        telefono,
        codigoHash: await argon2.hash(codigo, { type: argon2.argon2id }),
        expiraEn: new Date(Date.now() + OTP_VIGENCIA_MINUTOS * 60_000),
      },
    });

    await this.notificaciones.enviarCodigoOtp(telefono, codigo);

    return { enviado: true, expiraEnMinutos: OTP_VIGENCIA_MINUTOS };
  }

  /**
   * Verifica el codigo y devuelve el token del cliente.
   *
   * Si el telefono no existe en la base, hace falta el nombre para darlo de
   * alta (HU-C03). En ese caso el codigo NO se consume, para que el cliente
   * pueda reintentar con su nombre sin pedir otro.
   */
  async verificarCodigo(
    dto: VerificarCodigoDto,
  ): Promise<TokenResponse & { esNuevo: boolean; cuponesNuevos: number }> {
    const telefono = AuthService.normalizarTelefono(dto.telefono);

    const registro = await this.prisma.codigoOtp.findFirst({
      where: { telefono, consumidoEn: null, expiraEn: { gt: new Date() } },
      orderBy: { creadoEn: 'desc' },
    });

    if (!registro) {
      throw new UnauthorizedException('El código expiró o no existe. Pide uno nuevo.');
    }

    if (registro.intentos >= OTP_MAX_INTENTOS) {
      await this.prisma.codigoOtp.update({
        where: { id: registro.id },
        data: { consumidoEn: new Date() },
      });
      throw new UnauthorizedException('Demasiados intentos fallidos. Pide un código nuevo.');
    }

    const codigoValido = await argon2.verify(registro.codigoHash, dto.codigo).catch(() => false);
    if (!codigoValido) {
      await this.prisma.codigoOtp.update({
        where: { id: registro.id },
        data: { intentos: { increment: 1 } },
      });
      throw new UnauthorizedException('Código incorrecto');
    }

    let cliente = await this.prisma.cliente.findUnique({ where: { telefono } });
    const esNuevo = !cliente;

    if (!cliente) {
      const nombre = dto.nombre?.trim();
      if (!nombre) {
        // Codigo intacto a proposito: el frontend pide el nombre y reintenta.
        throw new BadRequestException({
          statusCode: 400,
          code: 'NOMBRE_REQUERIDO',
          message: 'Es tu primera vez en Rapidix. Dinos tu nombre para crear tu cuenta.',
        });
      }
      // Un codigo de fuente inventado se ignora en vez de guardarse: la
      // atribucion tiene que poder cruzarse con las fuentes reales.
      const fuenteCodigo = await this.fuentes.codigoValido(dto.fuenteCodigo);
      cliente = await this.prisma.cliente.create({ data: { nombre, telefono, fuenteCodigo } });
      this.logger.log(`Cliente nuevo dado de alta: ${cliente.id}`);
    }

    await this.prisma.codigoOtp.update({
      where: { id: registro.id },
      data: { consumidoEn: new Date() },
    });

    // Al identificar al cliente se evaluan los cupones que le correspondan
    // (Word 4.1). Un fallo aqui no puede impedirle entrar a la app.
    let cuponesNuevos = 0;
    try {
      const cicloVida = await this.cupones.evaluarAlIniciarSesion(cliente);
      const deCampania = await this.campanias.emitirCampaniasElegibles(cliente);
      cuponesNuevos = cicloVida.length + deCampania.length;
    } catch (error) {
      this.logger.error(
        `No se pudieron evaluar los cupones de ${cliente.id}: ${(error as Error).message}`,
      );
    }

    return {
      ...this.firmarToken({ sub: cliente.id, rol: ROL_CLIENTE, nombre: cliente.nombre }),
      esNuevo,
      cuponesNuevos,
    };
  }

  // ----------------------------------------------------------------

  firmarToken(payload: JwtPayload): TokenResponse {
    return {
      accessToken: this.jwt.sign(payload),
      rol: payload.rol,
      nombre: payload.nombre,
    };
  }

  /**
   * Hash de una contrasena que nadie conoce. Solo sirve para gastar el mismo
   * tiempo de CPU cuando el email no existe.
   */
  private static readonly HASH_SENUELO =
    '$argon2id$v=19$m=65536,t=3,p=4$c2VudWVsb3NlbnVlbG8$3s5vJ0mQ8Zx1cQZ0pQ7kZ8yX2vN1aB4cD6eF8gH0iJk';
}
