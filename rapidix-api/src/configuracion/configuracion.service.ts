import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfiguracionNegocio } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BancariosDto, HorarioDto, ParametrosDto } from './dto/configuracion.dto';

export interface HorarioResponse {
  diasServicio: Record<string, boolean>;
  abre: string;
  cierra: string;
  atenderFuera: boolean;
  incrementoFuera: number;
  whatsappAyuda: string | null;
}

export interface ParametrosResponse {
  costoEnvio: number;
  montoEnvioGratis: number;
  multiplicadorCashback: number;
  montoMinimoCashback: number;
}

export interface BancariosResponse {
  banco: string | null;
  beneficiario: string | null;
  numeroCuenta: string | null;
}

/** Lo que necesita la app del cliente: horario, envio y datos de pago. */
export interface ConfiguracionPublica {
  horario: Omit<HorarioResponse, 'incrementoFuera'> & { incrementoFuera: number };
  costoEnvio: number;
  montoEnvioGratis: number;
  datosBancarios: BancariosResponse;
  abiertoAhora: boolean;
}

const CLAVES_DIA = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'] as const;

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
      atenderFuera: c.atenderFuera,
      incrementoFuera: c.incrementoFuera.toNumber(),
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
        atenderFuera: dto.atenderFuera,
        incrementoFuera: dto.incrementoFuera,
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
    };
  }

  async guardarParametros(dto: ParametrosDto): Promise<ParametrosResponse> {
    await this.obtener();
    await this.prisma.configuracionNegocio.update({ where: { id: 1 }, data: { ...dto } });
    return this.verParametros();
  }

  async verBancarios(): Promise<BancariosResponse> {
    const c = await this.obtener();
    return { banco: c.banco, beneficiario: c.beneficiario, numeroCuenta: c.numeroCuenta };
  }

  async guardarBancarios(dto: BancariosDto): Promise<BancariosResponse> {
    await this.obtener();
    await this.prisma.configuracionNegocio.update({
      where: { id: 1 },
      data: {
        banco: dto.banco ?? null,
        beneficiario: dto.beneficiario ?? null,
        numeroCuenta: dto.numeroCuenta ?? null,
      },
    });
    return this.verBancarios();
  }

  async verPublica(): Promise<ConfiguracionPublica> {
    const c = await this.obtener();
    return {
      horario: await this.verHorario(),
      costoEnvio: c.costoEnvio.toNumber(),
      montoEnvioGratis: c.montoEnvioGratis.toNumber(),
      datosBancarios: await this.verBancarios(),
      abiertoAhora: ConfiguracionService.estaDentroDeHorario(c),
    };
  }

  /**
   * Si el momento dado cae dentro de los dias y horas de servicio.
   *
   * Lo usa el paso 19 para decidir si aplica el recargo por atencion fuera de
   * horario. Un horario que cierra antes de abrir (22:00 a 02:00) se entiende
   * como que cruza la medianoche.
   */
  static estaDentroDeHorario(config: ConfiguracionNegocio, momento = new Date()): boolean {
    const dias = config.diasServicio as Record<string, boolean>;
    const claveHoy = CLAVES_DIA[momento.getDay()];
    if (!dias[claveHoy]) return false;

    const minutos = momento.getHours() * 60 + momento.getMinutes();
    const aMinutos = (hhmm: string): number => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };
    const abre = aMinutos(config.abre);
    const cierra = aMinutos(config.cierra);

    return abre <= cierra
      ? minutos >= abre && minutos < cierra
      : minutos >= abre || minutos < cierra;
  }
}
