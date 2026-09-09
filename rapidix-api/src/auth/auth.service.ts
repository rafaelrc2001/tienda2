import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Cliente, Prospecto, RolUsuario } from '@prisma/client';
import { randomInt, randomUUID } from 'node:crypto';
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

/** Respuesta del paso 1 del login de cliente. */
export interface RespuestaSolicitarCodigo {
  enviado: true;
  expiraEnMinutos: number;
  /**
   * El codigo recien generado. Solo viaja aqui con `AUTH_OTP_BYPASS`; en el
   * flujo normal es `null` y el codigo unicamente sale por WhatsApp.
   */
  codigoAutomatico: string | null;
}

/** Parametros del OTP. Fijos: el Word no los deja configurables. */
const OTP_VIGENCIA_MINUTOS = 5;
const OTP_MAX_INTENTOS = 5;

/**
 * Codigo de relleno que se devuelve con el bypass.
 *
 * No se comprueba contra nada: solo sirve para que el paso 2 siga recibiendo
 * los seis digitos que exige su DTO.
 */
const OTP_RELLENO = '000000';

/**
 * Modo sin WhatsApp (`AUTH_OTP_BYPASS=true`).
 *
 * La integracion real con WhatsApp queda fuera del SPEC 01 (Word 8), asi que
 * sin ella el codigo solo aparece en el log del servidor y nadie puede pasar
 * del login. Con la variable encendida la API devuelve el codigo recien
 * generado en la respuesta del paso 1 y el frontend entra de largo, sin
 * enseñar la pantalla de los seis digitos.
 *
 * Lo que NO cambia: el OTP se sigue creando, caducando y consumiendo igual, y
 * `verificarCodigo` lo comprueba como siempre. Lo unico distinto es por donde
 * viaja el codigo. Aun asi, con esto cualquiera que sepa un telefono entra
 * como ese cliente: es para desarrollo y demos, nunca para produccion.
 */
export function otpSinEnvio(): boolean {
  return process.env.AUTH_OTP_BYPASS?.trim().toLowerCase() === 'true';
}

/**
 * Acceso directo por rol, sin credenciales (`AUTH_DEMO_LOGIN=true`).
 *
 * Simula lo que hara n8n: quien entra por WhatsApp ya viene identificado, asi
 * que la app no le pide nada. Mientras esa pieza no existe, la pantalla de
 * login ofrece los cinco modos del Word 2.4 y se entra tocando uno.
 *
 * Es un agujero del tamaño de la aplicacion: cualquiera se firma un token de
 * ADMINISTRADOR. Solo para probar los flujos; se apaga antes de que la use
 * nadie de fuera.
 */
export function demoLoginActivo(): boolean {
  return process.env.AUTH_DEMO_LOGIN?.trim().toLowerCase() === 'true';
}

/** Telefono del cliente de prueba. Falso a proposito. */
const TELEFONO_DEMO = '0000000000';

/** Con que nombre se da de alta cada identidad de prueba. */
const NOMBRE_DEMO: Readonly<Record<RolToken, string>> = {
  [ROL_CLIENTE]: 'Cliente de prueba',
  [RolUsuario.ADMINISTRADOR]: 'Administrador de prueba',
  [RolUsuario.RUTA]: 'Ruta de prueba',
  [RolUsuario.OPERACIONES]: 'Operaciones de prueba',
  [RolUsuario.FINANZAS]: 'Finanzas de prueba',
};

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
  // Acceso directo de simulacion
  // ----------------------------------------------------------------

  /**
   * Entra como el rol pedido sin comprobar nada (`AUTH_DEMO_LOGIN`).
   *
   * Reutiliza la identidad real del rol cuando existe —el administrador del
   * seed, por ejemplo— y solo inventa una cuando no hay ninguna, para que las
   * pruebas caigan siempre sobre los mismos datos.
   *
   * De la puerta para dentro no cambia nada: el token es el de siempre y los
   * permisos siguen saliendo de la matriz del Word 2.4.
   */
  async entrarDirecto(rol: RolToken): Promise<TokenResponse> {
    if (!demoLoginActivo()) {
      throw new ForbiddenException('El acceso directo está desactivado.');
    }
    this.logger.warn(`AUTH_DEMO_LOGIN: entrando como ${rol} sin credenciales.`);

    if (rol === ROL_CLIENTE) {
      const cliente =
        (await this.prisma.cliente.findUnique({ where: { telefono: TELEFONO_DEMO } })) ??
        (await this.prisma.cliente.create({
          data: { nombre: NOMBRE_DEMO[ROL_CLIENTE], telefono: TELEFONO_DEMO },
        }));

      // El cliente de prueba entra como CLIENTE, no como prospecto: es para
      // recorrer la app entera sin tener que comprar antes.
      return this.firmarToken({
        sub: cliente.id,
        rol: ROL_CLIENTE,
        nombre: cliente.nombre,
        tipo: 'CLIENTE',
      });
    }

    const usuario =
      (await this.prisma.usuario.findFirst({
        where: { rol, activo: true },
        orderBy: { creadoEn: 'asc' },
      })) ??
      (await this.prisma.usuario.create({
        data: {
          email: `demo-${rol.toLowerCase()}@rapidix.mx`,
          // Contrasena aleatoria que no conoce nadie: a este usuario se entra
          // por aqui y solo por aqui, nunca por /auth/staff/login.
          passwordHash: await AuthService.hashPassword(randomUUID()),
          nombre: NOMBRE_DEMO[rol],
          rol,
        },
      }));

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
  async solicitarCodigo(dto: SolicitarCodigoDto): Promise<RespuestaSolicitarCodigo> {
    const telefono = AuthService.normalizarTelefono(dto.telefono);

    // Con el bypass no se genera ni se guarda nada: `verificarCodigo` tampoco
    // va a comprobar ningun codigo. El relleno solo existe para que el
    // frontend siga llamando al paso 2 sin cambiar de forma.
    if (otpSinEnvio()) {
      this.logger.warn(`AUTH_OTP_BYPASS activo: ${telefono} entra sin codigo.`);
      return {
        enviado: true,
        expiraEnMinutos: OTP_VIGENCIA_MINUTOS,
        codigoAutomatico: OTP_RELLENO,
      };
    }

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

    return { enviado: true, expiraEnMinutos: OTP_VIGENCIA_MINUTOS, codigoAutomatico: null };
  }

  /**
   * Busca el OTP vivo del telefono y comprueba el codigo.
   *
   * Devuelve el registro sin consumirlo: quien llama lo marca solo cuando el
   * login termina de verdad, porque un alta a la que le falta el nombre tiene
   * que poder reintentar con el mismo codigo.
   */
  private async comprobarOtp(telefono: string, codigo: string) {
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

    const codigoValido = await argon2.verify(registro.codigoHash, codigo).catch(() => false);
    if (!codigoValido) {
      await this.prisma.codigoOtp.update({
        where: { id: registro.id },
        data: { intentos: { increment: 1 } },
      });
      throw new UnauthorizedException('Código incorrecto');
    }

    return registro;
  }

  /**
   * Verifica el codigo y devuelve el token de quien entra.
   *
   * **Solo `clientes` recuerda.** El telefono se busca ahi y en ningun otro
   * sitio: quien ya compro entra reconocido, y a quien no se le pide el
   * nombre, se haya registrado antes o no. Es deliberado: se es cliente al
   * comprar, y hasta entonces el negocio no da a nadie por conocido.
   *
   * El registro de quien todavia no ha comprado se guarda igual en
   * `prospectos`, una fila por telefono: volver a entrar actualiza esa fila
   * en vez de crear otra, asi que el listado de prospectos no se llena de
   * duplicados y no se pierde ni su direccion ni su cupon.
   *
   * Cuando falta el nombre el codigo NO se consume, para que pueda reintentar
   * sin pedir otro.
   */
  async verificarCodigo(
    dto: VerificarCodigoDto,
  ): Promise<TokenResponse & { esNuevo: boolean; cuponesNuevos: number }> {
    const telefono = AuthService.normalizarTelefono(dto.telefono);

    // Con AUTH_OTP_BYPASS no hay codigo que comprobar: el telefono entra
    // directo y `registro` se queda a null, asi que tampoco hay nada que
    // consumir mas abajo.
    const registro = otpSinEnvio() ? null : await this.comprobarOtp(telefono, dto.codigo);

    const cliente = await this.prisma.cliente.findUnique({ where: { telefono } });
    let prospecto: Prospecto | null = null;

    if (!cliente) {
      const nombre = dto.nombre?.trim();
      if (!nombre) {
        // Codigo intacto a proposito: el frontend pide el nombre y reintenta.
        throw new BadRequestException({
          statusCode: 400,
          code: 'NOMBRE_REQUERIDO',
          message: 'Dinos tu nombre para continuar.',
        });
      }

      // Un codigo de fuente inventado se ignora en vez de guardarse: la
      // atribucion tiene que poder cruzarse con las fuentes reales.
      const fuenteCodigo = await this.fuentes.codigoValido(dto.fuenteCodigo);

      // Una fila por telefono. Si ya se habia registrado se le actualiza el
      // nombre y se conserva todo lo demas: su direccion, su cupon y la
      // fuente por la que llego, que es del primer contacto.
      prospecto = await this.prisma.prospecto.upsert({
        where: { telefono },
        update: { nombre },
        create: { nombre, telefono, fuenteCodigo },
      });
      this.logger.log(`Prospecto registrado: ${prospecto.id}`);
    }

    // Para el frontend, "nuevo" es quien no es cliente: es lo que decide si
    // se le da la bienvenida.
    const esNuevo = !cliente;

    if (registro) {
      await this.prisma.codigoOtp.update({
        where: { id: registro.id },
        data: { consumidoEn: new Date() },
      });
    }

    // Al identificar a quien entra se evaluan los cupones que le correspondan
    // (Word 4.1). Un fallo aqui no puede impedirle entrar a la app.
    const cuponesNuevos = cliente
      ? await this.cuponesDelCliente(cliente)
      : await this.cuponesDelProspecto(prospecto!);

    const quien = cliente ?? prospecto!;
    return {
      ...this.firmarToken({
        sub: quien.id,
        rol: ROL_CLIENTE,
        nombre: quien.nombre,
        tipo: cliente ? 'CLIENTE' : 'PROSPECTO',
      }),
      esNuevo,
      cuponesNuevos,
    };
  }

  /** Ciclo de vida completo y campanias. Solo para quien ya es cliente. */
  private async cuponesDelCliente(cliente: Cliente): Promise<number> {
    try {
      const cicloVida = await this.cupones.evaluarAlIniciarSesion(cliente);
      const deCampania = await this.campanias.emitirCampaniasElegibles(cliente);
      return cicloVida.length + deCampania.length;
    } catch (error) {
      this.logger.error(
        `No se pudieron evaluar los cupones de ${cliente.id}: ${(error as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * Del prospecto solo se evalua el WELCOME.
   *
   * Los demas cupones del ciclo de vida miran el historial de compra
   * (inactividad, segunda compra) o datos que un prospecto no tiene
   * (cumpleanos), y las campanias segmentan sobre `clientes`. El de
   * bienvenida es justo el que tiene sentido aqui: es el que lo empuja a
   * hacer el primer pedido.
   */
  private async cuponesDelProspecto(prospecto: Prospecto): Promise<number> {
    try {
      return (await this.cupones.maybeIssueWelcomeProspecto(prospecto)) ? 1 : 0;
    } catch (error) {
      this.logger.error(
        `No se pudo emitir el cupón de bienvenida de ${prospecto.id}: ${(error as Error).message}`,
      );
      return 0;
    }
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
