import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModoTimbrado, Prisma, RazonSocial } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { REGIMENES_FISCALES, RegimenFiscal, tipoPersona } from './catalogos-sat';
import { RazonSocialDto } from './dto/razon-social.dto';
import { ConfigFacturaCom, configFacturaComDesdeEntorno } from './timbrador-factura-com';
import { Emisor, emisorDesdeEntorno } from './timbrador-simulado';

/**
 * El emisor con el que se va a timbrar: sus datos y, si las hay, las llaves de
 * factura.com con las que se timbra de verdad. Sin llaves es modo simulado.
 */
export interface EmisorElegido extends Emisor {
  /** Null cuando no hay ninguna razon social y se timbra con el del entorno. */
  id: string | null;
  facturaCom: ConfigFacturaCom | null;
}

/** Una razon social como la ve Configuracion -> Fiscal. Las llaves no viajan. */
export interface RazonSocialVistaDto {
  id: string;
  rfc: string;
  nombre: string;
  regimen: string;
  cp: string;
  principal: boolean;
  activa: boolean;
  facturaCom: {
    /** Tiene las tres llaves propias capturadas. */
    llavesPropias: boolean;
    serie: string | null;
    produccion: boolean;
  };
  /** Con que timbra hoy: con sus llaves (o la principal con las del entorno) o simulado. */
  modo: ModoTimbrado;
  /** Cuantas facturas emitio: con alguna ya no se borra, se desactiva. */
  facturas: number;
}

export interface RazonesSocialesDto {
  razones: RazonSocialVistaDto[];
  /** El catalogo viaja con los datos: la interfaz no lleva su propia copia. */
  regimenes: RegimenFiscal[];
  /** Si hay llaves en las variables de entorno: la principal sin llaves propias usa esas. */
  llavesDeEntorno: boolean;
}

/** Lo que el punto de venta ofrece para elegir emisor. */
export interface EmisorParaElegirDto {
  id: string;
  rfc: string;
  nombre: string;
  regimen: string;
  cp: string;
  principal: boolean;
  modo: ModoTimbrado;
}

/**
 * Configuracion -> Fiscal -> Razones sociales, y de cual se sacan el emisor y
 * las llaves de cada timbre.
 *
 * Las llaves: las propias si tiene las tres; si no, la principal usa las de
 * las variables `FACTURACOM_*` (asi funcionaba con un solo emisor y asi sigue
 * una instalacion que no capture llaves) y las demas timbran simulado.
 */
@Injectable()
export class RazonesSocialesService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(): Promise<RazonesSocialesDto> {
    const [razones, conteos] = await Promise.all([
      this.prisma.razonSocial.findMany({ orderBy: [{ principal: 'desc' }, { nombre: 'asc' }] }),
      this.conteoDeFacturas(),
    ]);
    return {
      razones: razones.map((r) => this.aVista(r, conteos.get(r.id) ?? 0)),
      regimenes: REGIMENES_FISCALES,
      llavesDeEntorno: configFacturaComDesdeEntorno() !== null,
    };
  }

  /**
   * Alta. La primera que se da de alta nace principal: sin principal no habria
   * con que facturar desde la app.
   */
  async crear(dto: RazonSocialDto): Promise<RazonesSocialesDto> {
    RazonesSocialesService.exigirRegimenDelRfc(dto);
    const llaves = RazonesSocialesService.llaves(null, dto);
    await this.conRfcUnico(() =>
      this.prisma.$transaction(async (tx) => {
        const hayPrincipal = (await tx.razonSocial.count({ where: { principal: true } })) > 0;
        const principal = dto.principal === true || !hayPrincipal;
        if (principal && hayPrincipal) {
          await tx.razonSocial.updateMany({
            where: { principal: true },
            data: { principal: false },
          });
        }
        if (principal && dto.activa === false) throw RazonesSocialesService.principalApagada();
        await tx.razonSocial.create({
          data: {
            rfc: dto.rfc,
            nombre: dto.nombre,
            regimen: dto.regimen,
            cp: dto.cp,
            principal,
            activa: dto.activa ?? true,
            ...llaves,
          },
        });
      }),
    );
    return this.listar();
  }

  /**
   * Cambio. La principal no se apaga ni deja de serlo por si sola: se marca
   * otra como principal y esta deja de serlo en la misma transaccion.
   */
  async actualizar(id: string, dto: RazonSocialDto): Promise<RazonesSocialesDto> {
    RazonesSocialesService.exigirRegimenDelRfc(dto);
    const actual = await this.prisma.razonSocial.findUnique({ where: { id } });
    if (!actual) throw new NotFoundException('La razón social no existe');

    const principal = dto.principal ?? actual.principal;
    const activa = dto.activa ?? actual.activa;
    if (actual.principal && !principal) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'SIN_PRINCIPAL',
        message: 'Siempre tiene que haber una principal: marca otra como principal en su lugar.',
      });
    }
    if (principal && !activa) throw RazonesSocialesService.principalApagada();

    const llaves = RazonesSocialesService.llaves(actual, dto);
    await this.conRfcUnico(() =>
      this.prisma.$transaction(async (tx) => {
        if (principal && !actual.principal) {
          await tx.razonSocial.updateMany({
            where: { principal: true },
            data: { principal: false },
          });
        }
        await tx.razonSocial.update({
          where: { id },
          data: {
            rfc: dto.rfc,
            nombre: dto.nombre,
            regimen: dto.regimen,
            cp: dto.cp,
            principal,
            activa,
            ...llaves,
          },
        });
      }),
    );
    return this.listar();
  }

  /** Sin facturas se borra; con alguna lo impide la llave foranea y se pide desactivarla. */
  async eliminar(id: string): Promise<RazonesSocialesDto> {
    const actual = await this.prisma.razonSocial.findUnique({ where: { id } });
    if (!actual) throw new NotFoundException('La razón social no existe');
    if (actual.principal) {
      throw new ConflictException({
        statusCode: 409,
        code: 'ES_PRINCIPAL',
        message: 'La principal no se elimina: marca otra como principal primero.',
      });
    }
    try {
      await this.prisma.razonSocial.delete({ where: { id } });
    } catch (fallo) {
      if (fallo instanceof Prisma.PrismaClientKnownRequestError && fallo.code === 'P2003') {
        throw new ConflictException({
          statusCode: 409,
          code: 'RAZON_SOCIAL_CON_FACTURAS',
          message: 'Ya emitió facturas y no se puede eliminar: desactívala.',
        });
      }
      throw fallo;
    }
    return this.listar();
  }

  // ----------------------------------------------------------------
  // De donde sale el emisor de cada timbre
  // ----------------------------------------------------------------

  /**
   * El emisor de Mis pedidos, Finanzas y la factura global. Sin ninguna razon
   * social dada de alta, el de las variables de entorno con sus llaves: es
   * como se timbraba antes de que hubiera razones sociales.
   */
  async principal(): Promise<EmisorElegido> {
    const razon = await this.prisma.razonSocial.findFirst({ where: { principal: true } });
    if (!razon) {
      return { id: null, ...emisorDesdeEntorno(), facturaCom: configFacturaComDesdeEntorno() };
    }
    return RazonesSocialesService.elegido(razon);
  }

  /** La que eligio el punto de venta. Tiene que existir y estar activa. */
  async activa(id: string): Promise<EmisorElegido> {
    const razon = await this.prisma.razonSocial.findUnique({ where: { id } });
    if (!razon?.activa) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'RAZON_SOCIAL_NO_DISPONIBLE',
        message: 'Esa razón social ya no está disponible: elige otra.',
      });
    }
    return RazonesSocialesService.elegido(razon);
  }

  /** Las activas, la principal primero: el selector del punto de venta. */
  async paraElegir(): Promise<EmisorParaElegirDto[]> {
    const razones = await this.prisma.razonSocial.findMany({
      where: { activa: true },
      orderBy: [{ principal: 'desc' }, { nombre: 'asc' }],
    });
    return razones.map((r) => ({
      id: r.id,
      rfc: r.rfc,
      nombre: r.nombre,
      regimen: r.regimen,
      cp: r.cp,
      principal: r.principal,
      modo: RazonesSocialesService.modoDe(r),
    }));
  }

  /**
   * Las llaves con las que se piden el PDF y el XML de una factura ya timbrada
   * en factura.com: las de su razon social si las tiene, y si no las del
   * entorno, que son con las que se timbro (la de antes de que hubiera razones
   * sociales, o una que despues dejo de ser la principal).
   */
  async llavesParaDocumentos(razonSocialId: string | null): Promise<ConfigFacturaCom | null> {
    if (razonSocialId) {
      const razon = await this.prisma.razonSocial.findUnique({ where: { id: razonSocialId } });
      const propias = razon && RazonesSocialesService.llavesPropias(razon);
      if (propias) return propias;
    }
    return configFacturaComDesdeEntorno();
  }

  // ----------------------------------------------------------------

  private static elegido(razon: RazonSocial): EmisorElegido {
    return {
      id: razon.id,
      rfc: razon.rfc,
      nombre: razon.nombre,
      regimen: razon.regimen,
      cp: razon.cp,
      facturaCom: RazonesSocialesService.llavesParaTimbrar(razon),
    };
  }

  private static llavesPropias(razon: RazonSocial): ConfigFacturaCom | null {
    if (!razon.facturaComApiKey || !razon.facturaComSecretKey || !razon.facturaComSerie) {
      return null;
    }
    return {
      apiKey: razon.facturaComApiKey,
      secretKey: razon.facturaComSecretKey,
      serie: razon.facturaComSerie,
      sandbox: !razon.facturaComProduccion,
    };
  }

  private static llavesParaTimbrar(razon: RazonSocial): ConfigFacturaCom | null {
    return (
      RazonesSocialesService.llavesPropias(razon) ??
      (razon.principal ? configFacturaComDesdeEntorno() : null)
    );
  }

  private static modoDe(razon: RazonSocial): ModoTimbrado {
    return RazonesSocialesService.llavesParaTimbrar(razon)
      ? ModoTimbrado.FACTURA_COM
      : ModoTimbrado.SIMULADO;
  }

  private aVista(r: RazonSocial, facturas: number): RazonSocialVistaDto {
    return {
      id: r.id,
      rfc: r.rfc,
      nombre: r.nombre,
      regimen: r.regimen,
      cp: r.cp,
      principal: r.principal,
      activa: r.activa,
      facturaCom: {
        llavesPropias: RazonesSocialesService.llavesPropias(r) !== null,
        serie: r.facturaComSerie,
        produccion: r.facturaComProduccion,
      },
      modo: RazonesSocialesService.modoDe(r),
      facturas,
    };
  }

  /** Facturas de pedidos y globales de cada razon social, contadas en vivo. */
  private async conteoDeFacturas(): Promise<Map<string, number>> {
    const [dePedidos, globales] = await Promise.all([
      this.prisma.factura.groupBy({
        by: ['razonSocialId'],
        where: { razonSocialId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.facturaGlobal.groupBy({
        by: ['razonSocialId'],
        where: { razonSocialId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const cuenta = new Map<string, number>();
    for (const g of [...dePedidos, ...globales]) {
      if (g.razonSocialId) {
        cuenta.set(g.razonSocialId, (cuenta.get(g.razonSocialId) ?? 0) + g._count._all);
      }
    }
    return cuenta;
  }

  /**
   * Las columnas de llaves que se escriben. Lo que no llega se queda como
   * estaba; `quitarLlaves` las borra. Lo que queda tiene que ser las tres o
   * ninguna: con una sola no se timbra y no se notaria hasta el primer timbre.
   */
  private static llaves(
    actual: RazonSocial | null,
    dto: RazonSocialDto,
  ): Pick<
    Prisma.RazonSocialUncheckedCreateInput,
    'facturaComApiKey' | 'facturaComSecretKey' | 'facturaComSerie' | 'facturaComProduccion'
  > {
    const quedan = dto.quitarLlaves
      ? { facturaComApiKey: null, facturaComSecretKey: null, facturaComSerie: null }
      : {
          facturaComApiKey: dto.facturaComApiKey ?? actual?.facturaComApiKey ?? null,
          facturaComSecretKey: dto.facturaComSecretKey ?? actual?.facturaComSecretKey ?? null,
          facturaComSerie: dto.facturaComSerie ?? actual?.facturaComSerie ?? null,
        };
    const puestas = Object.values(quedan).filter(Boolean).length;
    if (puestas !== 0 && puestas !== 3) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'LLAVES_INCOMPLETAS',
        message:
          'Para timbrar con factura.com hacen falta las tres: API key, secret key y serie. Deja las tres vacías para timbrar en modo simulado.',
      });
    }
    return {
      ...quedan,
      facturaComProduccion: dto.facturaComProduccion ?? actual?.facturaComProduccion ?? false,
    };
  }

  /**
   * El SAT rechaza el CFDI si el regimen no es del tipo de persona del RFC: se
   * dice al guardar y no al timbrar la primera factura.
   */
  private static exigirRegimenDelRfc(dto: RazonSocialDto): void {
    const persona = tipoPersona(dto.rfc);
    const regimen = REGIMENES_FISCALES.find((r) => r.clave === dto.regimen);
    if (regimen && !regimen.personas.includes(persona)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'REGIMEN_NO_CORRESPONDE',
        message:
          persona === 'MORAL'
            ? 'Ese régimen es de personas físicas y el RFC es de persona moral (12 caracteres).'
            : 'Ese régimen es de personas morales y el RFC es de persona física (13 caracteres).',
      });
    }
  }

  private static principalApagada(): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      code: 'PRINCIPAL_INACTIVA',
      message: 'La principal no se puede desactivar: marca otra como principal primero.',
    });
  }

  private async conRfcUnico(trabajo: () => Promise<void>): Promise<void> {
    try {
      await trabajo();
    } catch (fallo) {
      if (fallo instanceof Prisma.PrismaClientKnownRequestError && fallo.code === 'P2002') {
        throw new ConflictException({
          statusCode: 409,
          code: 'RFC_REPETIDO',
          message: 'Ya hay una razón social con ese RFC.',
        });
      }
      throw fallo;
    }
  }
}
