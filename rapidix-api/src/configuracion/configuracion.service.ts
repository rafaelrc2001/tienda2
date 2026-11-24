import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfiguracionNegocio, CuentaBancaria, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CLAVES_DIA, HorarioSemanal, estaAbierto } from './horario';
import {
  BancariosDto,
  CuentaBancariaDto,
  HorarioDto,
  ParametrosDto,
} from './dto/configuracion.dto';

/**
 * Horario del envio a domicilio. Ya no bloquea ni encarece nada: fuera de el
 * el pedido se acepta y el carrito avisa que queda para la siguiente apertura.
 */
export interface HorarioResponse {
  diasServicio: Record<string, boolean>;
  abre: string;
  cierra: string;
  whatsappAyuda: string | null;
}

export interface ParametrosResponse {
  costoEnvio: number;
  montoEnvioGratis: number;
  multiplicadorCashback: number;
  montoMinimoCashback: number;
  controlInventario: boolean;
}

/** Una de las dos cuentas para transferir, como la ve el cliente. */
export interface CuentaPagoResponse {
  banco: string | null;
  beneficiario: string | null;
  numeroCuenta: string | null;
  numeroTarjeta: string | null;
  clabe: string | null;
}

/** Datos bancarios del panel: que cuentas del directorio se dan al cliente. */
export interface BancariosResponse {
  cuentaPrincipalId: string | null;
  cuentaSecundariaId: string | null;
}

/** Sin tarjeta ni CLABE una cuenta no sirve para transferir. */
const sirveParaCobrar = (c: { numeroTarjeta: string | null; clabe: string | null }) =>
  !!(c.numeroTarjeta || c.clabe);

/** Lo que necesita la app del cliente: horario, envio y datos de pago. */
export interface ConfiguracionPublica {
  horario: HorarioResponse;
  costoEnvio: number;
  montoEnvioGratis: number;
  /** Cuenta principal: la de quien marca "Requiero factura". */
  datosBancarios: CuentaPagoResponse;
  /**
   * La cuenta de quien NO pide factura, ya resuelta: la secundaria, o la
   * principal mientras la secundaria no tenga ni tarjeta ni CLABE. Asi el
   * cliente nunca se queda sin a donde transferir.
   */
  datosBancariosSinFactura: CuentaPagoResponse;
  abiertoAhora: boolean;
}

@Injectable()
export class ConfiguracionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * La configuracion es una fila unica (id = 1) que crea el seed. Si no
   * existe, es mejor fallar claro que inventarse un costo de envio.
   */
  async obtener(): Promise<ConfiguracionNegocio> {
    const config = await this.prisma.configuracionNegocio.findUnique({ where: { id: 1 } });
    if (!config) {
      throw new InternalServerErrorException(
        'Falta la configuración del negocio. Ejecuta `npx prisma db seed`.',
      );
    }
    return config;
  }

  async verHorario(): Promise<HorarioResponse> {
    const c = await this.obtener();
    return {
      diasServicio: c.diasServicio as Record<string, boolean>,
      abre: c.abre,
      cierra: c.cierra,
      whatsappAyuda: c.whatsappAyuda,
    };
  }

  async guardarHorario(dto: HorarioDto): Promise<HorarioResponse> {
    await this.obtener();
    await this.prisma.configuracionNegocio.update({
      where: { id: 1 },
      data: {
        diasServicio: { ...dto.diasServicio },
        abre: dto.abre,
        cierra: dto.cierra,
        whatsappAyuda: dto.whatsappAyuda ?? null,
      },
    });
    return this.verHorario();
  }

  async verParametros(): Promise<ParametrosResponse> {
    const c = await this.obtener();
    return {
      costoEnvio: c.costoEnvio.toNumber(),
      montoEnvioGratis: c.montoEnvioGratis.toNumber(),
      multiplicadorCashback: c.multiplicadorCashback.toNumber(),
      montoMinimoCashback: c.montoMinimoCashback.toNumber(),
      controlInventario: c.controlInventario,
    };
  }

  async guardarParametros(dto: ParametrosDto): Promise<ParametrosResponse> {
    await this.obtener();
    await this.prisma.configuracionNegocio.update({ where: { id: 1 }, data: { ...dto } });
    return this.verParametros();
  }

  /** Lo que ve el cliente de una cuenta del directorio; sin cuenta, todo en `null`. */
  private static paraCliente(c: CuentaBancaria | null): CuentaPagoResponse {
    return {
      banco: c?.banco ?? null,
      beneficiario: c?.titular ?? null,
      numeroCuenta: c?.numeroCuenta ?? null,
      numeroTarjeta: c?.numeroTarjeta ?? null,
      clabe: c?.clabe ?? null,
    };
  }

  async verBancarios(): Promise<BancariosResponse> {
    const c = await this.obtener();
    return { cuentaPrincipalId: c.cuentaPrincipalId, cuentaSecundariaId: c.cuentaSecundariaId };
  }

  /**
   * Elige las dos cuentas del directorio. Una cuenta sin tarjeta ni CLABE no
   * se puede elegir: el cliente no tendria a donde transferir.
   */
  async guardarBancarios(dto: BancariosDto): Promise<BancariosResponse> {
    await this.obtener();
    const cuentaPrincipalId = dto.cuentaPrincipalId ?? null;
    const cuentaSecundariaId = dto.cuentaSecundariaId ?? null;
    for (const [id, nombre] of [
      [cuentaPrincipalId, 'principal'],
      [cuentaSecundariaId, 'secundaria'],
    ] as const) {
      if (!id) continue;
      const cuenta = await this.prisma.cuentaBancaria.findUnique({ where: { id } });
      if (!cuenta) throw new NotFoundException(`La cuenta ${nombre} ya no existe en el directorio`);
      if (!sirveParaCobrar(cuenta)) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'CUENTA_SIN_DATOS_DE_PAGO',
          message: `La cuenta ${cuenta.numeroCuenta} de ${cuenta.banco} no tiene tarjeta ni CLABE: agrégale una para darla al cliente.`,
        });
      }
    }
    await this.prisma.configuracionNegocio.update({
      where: { id: 1 },
      data: { cuentaPrincipalId, cuentaSecundariaId },
    });
    return this.verBancarios();
  }

  listarCuentasBancarias(): Promise<CuentaBancaria[]> {
    return this.prisma.cuentaBancaria.findMany({ orderBy: { creadoEn: 'asc' } });
  }

  /**
   * La misma cuenta dos veces (mismo numero en el mismo banco, sin importar
   * mayusculas) no se da de alta: en Bancos saldria repetida y sus periodos
   * quedarian repartidos entre las dos. `exceptoId` es la que se esta editando.
   */
  private async rechazarRepetida(dto: CuentaBancariaDto, exceptoId?: string): Promise<void> {
    const repetida = await this.prisma.cuentaBancaria.findFirst({
      where: {
        numeroCuenta: dto.numeroCuenta,
        banco: { equals: dto.banco, mode: 'insensitive' },
        ...(exceptoId ? { id: { not: exceptoId } } : {}),
      },
    });
    if (repetida) {
      throw new ConflictException({
        statusCode: 409,
        code: 'CUENTA_DUPLICADA',
        message: `La cuenta ${dto.numeroCuenta} de ${repetida.banco} ya está dada de alta.`,
      });
    }
  }

  private static datosDeCuenta(dto: CuentaBancariaDto) {
    return {
      banco: dto.banco,
      numeroCuenta: dto.numeroCuenta,
      titular: dto.titular,
      numeroTarjeta: dto.numeroTarjeta ?? null,
      clabe: dto.clabe ?? null,
    };
  }

  async crearCuentaBancaria(dto: CuentaBancariaDto): Promise<CuentaBancaria> {
    await this.rechazarRepetida(dto);
    return this.prisma.cuentaBancaria.create({ data: ConfiguracionService.datosDeCuenta(dto) });
  }

  /**
   * Edita una cuenta del directorio. Si es la principal o la secundaria, no
   * puede quedarse sin tarjeta ni CLABE: el cliente se quedaria sin a donde
   * transferir.
   */
  async actualizarCuentaBancaria(id: string, dto: CuentaBancariaDto): Promise<CuentaBancaria> {
    const actual = await this.prisma.cuentaBancaria.findUnique({ where: { id } });
    if (!actual) throw new NotFoundException('La cuenta bancaria no existe');
    await this.rechazarRepetida(dto, id);
    const datos = ConfiguracionService.datosDeCuenta(dto);
    const uso = sirveParaCobrar(datos) ? null : await this.usoDeCuenta(id);
    if (uso) {
      throw new ConflictException({
        statusCode: 409,
        code: 'CUENTA_EN_USO',
        message: `Es la cuenta ${uso} para transferir: necesita tarjeta o CLABE.`,
      });
    }
    return this.prisma.cuentaBancaria.update({ where: { id }, data: datos });
  }

  /** 'principal' o 'secundaria' si la cuenta esta elegida para cobrar; si no, `null`. */
  private async usoDeCuenta(id: string): Promise<'principal' | 'secundaria' | null> {
    const c = await this.obtener();
    if (c.cuentaPrincipalId === id) return 'principal';
    if (c.cuentaSecundariaId === id) return 'secundaria';
    return null;
  }

  /**
   * Una cuenta con periodos en Finanzas -> Bancos no se borra: se perderia su
   * estado de cuenta. Lo impide la llave foranea (`onDelete: Restrict`). Una
   * elegida como principal o secundaria tampoco: primero se elige otra.
   */
  async eliminarCuentaBancaria(id: string): Promise<void> {
    const uso = await this.usoDeCuenta(id);
    if (uso) {
      throw new ConflictException({
        statusCode: 409,
        code: 'CUENTA_EN_USO',
        message: `Es la cuenta ${uso} para transferir. Elige otra en su lugar antes de eliminarla.`,
      });
    }
    try {
      const { count } = await this.prisma.cuentaBancaria.deleteMany({ where: { id } });
      if (count === 0) throw new NotFoundException('La cuenta bancaria no existe');
    } catch (fallo) {
      if (fallo instanceof Prisma.PrismaClientKnownRequestError && fallo.code === 'P2003') {
        throw new ConflictException({
          statusCode: 409,
          code: 'CUENTA_CON_PERIODOS',
          message: 'La cuenta ya tiene periodos en Finanzas → Bancos y no se puede eliminar.',
        });
      }
      throw fallo;
    }
  }

  async verPublica(): Promise<ConfiguracionPublica> {
    const c = await this.obtener();
    const cuentas = await this.prisma.configuracionNegocio.findUniqueOrThrow({
      where: { id: 1 },
      select: { cuentaPrincipal: true, cuentaSecundaria: true },
    });
    const principal = ConfiguracionService.paraCliente(cuentas.cuentaPrincipal);
    const secundaria = ConfiguracionService.paraCliente(cuentas.cuentaSecundaria);
    const secundariaUsable = sirveParaCobrar(secundaria);
    return {
      horario: await this.verHorario(),
      costoEnvio: c.costoEnvio.toNumber(),
      montoEnvioGratis: c.montoEnvioGratis.toNumber(),
      datosBancarios: principal,
      datosBancariosSinFactura: secundariaUsable ? secundaria : principal,
      abiertoAhora: ConfiguracionService.estaDentroDeHorario(c),
    };
  }

  /**
   * El horario general (el del envio a domicilio) en forma semanal: los dias
   * marcados con las mismas horas. Asi se mide con las mismas funciones que
   * el horario de cada tienda.
   */
  static horarioDomicilio(config: ConfiguracionNegocio): HorarioSemanal {
    const dias = config.diasServicio as Record<string, boolean>;
    return Object.fromEntries(
      CLAVES_DIA.map((clave) => [
        clave,
        dias[clave] ? { abre: config.abre, cierra: config.cierra } : null,
      ]),
    );
  }

  /**
   * Si el momento dado cae dentro del horario general. Un horario que cierra
   * antes de abrir (22:00 a 02:00) se entiende como que cruza la medianoche.
   */
  static estaDentroDeHorario(config: ConfiguracionNegocio, momento?: Date, zona?: string): boolean {
    return estaAbierto(ConfiguracionService.horarioDomicilio(config), momento, zona);
  }
}
