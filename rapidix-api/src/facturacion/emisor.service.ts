import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ModoTimbrado } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { REGIMENES_FISCALES } from './catalogos-sat';
import {
  ConfigFacturaCom,
  configFacturaComDesdeEntorno,
  cuentasFacturaComDesdeEntorno,
  EmisorDeCuenta,
  TimbradorFacturaCom,
} from './timbrador-factura-com';
import { emisorDesdeEntorno } from './timbrador-simulado';

/**
 * El emisor con el que se va a timbrar: sus datos y, si las hay, las llaves de
 * factura.com con las que se timbra de verdad. Sin llaves es modo simulado.
 */
export interface EmisorElegido {
  rfc: string;
  nombre: string;
  /** Clave c_RegimenFiscal. Null si factura.com dio un regimen que no se reconoce. */
  regimen: string | null;
  /** Lugar de expedicion. Null si la cuenta de factura.com no lo tiene capturado. */
  cp: string | null;
  facturaCom: ConfigFacturaCom | null;
}

/** Un emisor para elegir: en el punto de venta, en la factura global y en Tiendas. */
export interface EmisorOpcionDto {
  rfc: string;
  nombre: string;
  /**
   * CP fiscal de la cuenta: es el del receptor cuando se factura a PUBLICO EN
   * GENERAL (CFDI40149), y la hoja lo llena. Null si la cuenta no lo tiene.
   */
  cp: string | null;
}

/** Una cuenta de factura.com del servidor, como la ensena Configuracion -> Fiscal. */
export interface EmisorCuentaDto {
  rfc: string;
  nombre: string;
  regimen: string | null;
  regimenNombre: string | null;
  cp: string | null;
  /** La de `FACTURACOM_API_KEY`: con la que se factura si nada dice otra cosa. */
  principal: boolean;
}

/** Configuracion -> Fiscal -> Emisor: con que y a nombre de quien se factura. */
export interface EmisorServidorDto {
  modo: ModoTimbrado;
  /** Entorno de factura.com. Null en modo simulado. */
  entorno: 'PRODUCCION' | 'SANDBOX' | null;
  /** Las que se pudieron leer, la principal primero. */
  emisores: EmisorCuentaDto[];
  /** Por que alguna cuenta no se pudo leer; null si se leyeron todas. */
  error: string | null;
}

/** Los datos de la cuenta casi nunca cambian: no se piden en cada factura. */
const VIGENCIA_CUENTA_MS = 10 * 60 * 1000;

/**
 * De donde sale el emisor de cada factura: las cuentas de factura.com del
 * servidor (`FACTURACOM_*`, una por RFC: la principal y las de sufijo `_2`,
 * `_3`...) y los datos fiscales de cada una.
 *
 * DECISION: los datos del emisor no se capturan, se leen de la cuenta. Antes
 * cada razon social de Configuracion -> Fiscal traia sus datos capturados a
 * mano y se separaron de la cuenta que de verdad sellaba (otro RFC y otro
 * regimen en pantalla, y sin la retencion del RESICO). factura.com sella con el
 * CSD de la cuenta de las llaves, asi que el emisor es esa cuenta.
 *
 * Con que cuenta se factura: la que se elija (el punto de venta y la factura
 * global ofrecen la lista); si no, la asignada a la tienda del pedido
 * (`Tienda.emisorRfc`); si no, la principal. Los emisores se identifican por
 * RFC: es lo que queda congelado en la factura.
 *
 * Sin llaves se timbra simulado con el emisor de pruebas
 * (`FACTURACION_EMISOR_*`), como siempre.
 *
 * La tabla `razones_sociales` se queda por las facturas que ya apuntan a
 * ella: sus PDF y XML se siguen pidiendo con las llaves con que se timbraron.
 */
@Injectable()
export class EmisorService {
  private readonly logger = new Logger(EmisorService.name);
  private readonly cache = new Map<string, { emisor: EmisorDeCuenta; vence: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /** Con que se timbra hoy. No llama a nadie: solo mira si hay llaves. */
  modo(): ModoTimbrado {
    return configFacturaComDesdeEntorno() ? ModoTimbrado.FACTURA_COM : ModoTimbrado.SIMULADO;
  }

  /**
   * Los emisores con los que se puede facturar, el principal primero. Una
   * cuenta que no se puede leer se deja fuera (y queda en el log) para que no
   * tumbe a las demas; si no se lee ninguna, 502: timbrar tampoco se podria.
   */
  async disponibles(): Promise<EmisorElegido[]> {
    const cuentas = cuentasFacturaComDesdeEntorno();
    if (cuentas.length === 0) return [{ ...emisorDesdeEntorno(), facturaCom: null }];
    const leidas = await this.leer(cuentas);
    const listos = leidas
      .filter((l) => l.emisor)
      .map((l) => ({ ...l.emisor!, facturaCom: l.llaves }));
    if (listos.length === 0) {
      throw new BadGatewayException({
        statusCode: 502,
        code: 'PROVEEDOR_NO_DISPONIBLE',
        message: 'No pudimos conectar con el servicio de facturación. Inténtalo en unos minutos.',
      });
    }
    return listos;
  }

  /** Para un selector: RFC y nombre de cada emisor disponible. */
  async opciones(): Promise<EmisorOpcionDto[]> {
    return (await this.disponibles()).map((e) => ({ rfc: e.rfc, nombre: e.nombre, cp: e.cp }));
  }

  /**
   * El emisor de una factura nueva: el del `rfc` pedido (400 si no es una de
   * las cuentas), si no el asignado a la tienda, si no el principal. Una
   * tienda con un RFC que ya no esta configurado factura con el principal.
   */
  async elegir(
    opciones: { rfc?: string | null; tiendaId?: string | null } = {},
  ): Promise<EmisorElegido> {
    const lista = await this.disponibles();
    if (opciones.rfc) {
      const pedido = lista.find((e) => e.rfc === opciones.rfc);
      if (!pedido) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'EMISOR_INVALIDO',
          message: 'Ese RFC no es una de las cuentas de facturación del negocio.',
        });
      }
      return pedido;
    }
    const deLaTienda = await this.rfcDeTienda(opciones.tiendaId);
    if (deLaTienda) {
      const asignado = lista.find((e) => e.rfc === deLaTienda);
      if (asignado) return asignado;
      this.logger.warn(
        `La tienda ${opciones.tiendaId} factura con ${deLaTienda}, que no esta disponible`,
      );
    }
    return lista[0];
  }

  /** El RFC con que factura la tienda por defecto, o null (el principal). */
  async rfcDeTienda(tiendaId: string | null | undefined): Promise<string | null> {
    if (!tiendaId) return null;
    const tienda = await this.prisma.tienda.findUnique({
      where: { id: tiendaId },
      select: { emisorRfc: true },
    });
    return tienda?.emisorRfc ?? null;
  }

  /** Lo que ensena Configuracion -> Fiscal. No lanza: el fallo va en `error`. */
  async vista(): Promise<EmisorServidorDto> {
    const cuentas = cuentasFacturaComDesdeEntorno();
    const nombreDe = (clave: string | null) =>
      REGIMENES_FISCALES.find((r) => r.clave === clave)?.nombre ?? null;
    if (cuentas.length === 0) {
      const e = emisorDesdeEntorno();
      return {
        modo: this.modo(),
        entorno: null,
        emisores: [{ ...e, regimenNombre: nombreDe(e.regimen), principal: true }],
        error: null,
      };
    }
    const leidas = await this.leer(cuentas);
    const fallos = leidas.filter((l) => l.error).map((l) => l.error!);
    return {
      modo: this.modo(),
      entorno: cuentas[0].sandbox ? 'SANDBOX' : 'PRODUCCION',
      emisores: leidas
        .filter((l) => l.emisor)
        .map((l) => ({
          rfc: l.emisor!.rfc,
          nombre: l.emisor!.nombre,
          regimen: l.emisor!.regimen,
          regimenNombre: nombreDe(l.emisor!.regimen),
          cp: l.emisor!.cp,
          principal: l.llaves === cuentas[0],
        })),
      error: fallos.length > 0 ? fallos.join(' · ') : null,
    };
  }

  /**
   * Las llaves con las que se piden el PDF y el XML de una factura ya timbrada
   * en factura.com: las de la cuenta que la timbro.
   *
   * Las de antes de que el emisor saliera del servidor pudieron timbrarse con
   * las llaves propias de una razon social: esas se siguen usando. Las demas,
   * las de la cuenta con su RFC; sin RFC congelado (de antes de que hubiera
   * varias), la principal.
   */
  async llavesParaDocumentos(
    razonSocialId: string | null,
    emisorRfc: string | null,
  ): Promise<ConfigFacturaCom | null> {
    if (razonSocialId) {
      const razon = await this.prisma.razonSocial.findUnique({ where: { id: razonSocialId } });
      if (razon?.facturaComApiKey && razon.facturaComSecretKey && razon.facturaComSerie) {
        return {
          apiKey: razon.facturaComApiKey,
          secretKey: razon.facturaComSecretKey,
          serie: razon.facturaComSerie,
          sandbox: !razon.facturaComProduccion,
        };
      }
    }
    const cuentas = cuentasFacturaComDesdeEntorno();
    if (emisorRfc && cuentas.length > 1) {
      const leidas = await this.leer(cuentas);
      const suya = leidas.find((l) => l.emisor?.rfc === emisorRfc);
      if (suya) return suya.llaves;
    }
    return cuentas[0] ?? null;
  }

  /** Cada cuenta con su emisor, o con el motivo por el que no se pudo leer. */
  private leer(
    cuentas: ConfigFacturaCom[],
  ): Promise<{ llaves: ConfigFacturaCom; emisor: EmisorDeCuenta | null; error: string | null }[]> {
    return Promise.all(
      cuentas.map(async (llaves, i) => {
        try {
          return { llaves, emisor: await this.cuentaDe(llaves), error: null };
        } catch (fallo) {
          const motivo = fallo instanceof Error ? fallo.message : String(fallo);
          const cual = i === 0 ? 'principal' : `_${i + 1}`;
          this.logger.error(`No se leyo la cuenta de factura.com ${cual}: ${motivo}`);
          return { llaves, emisor: null, error: `Cuenta ${cual}: ${motivo}` };
        }
      }),
    );
  }

  /** La cuenta de esas llaves, de memoria mientras siga vigente. */
  private async cuentaDe(llaves: ConfigFacturaCom): Promise<EmisorDeCuenta> {
    const llave = `${llaves.sandbox ? 's' : 'p'}:${llaves.apiKey}`;
    const guardada = this.cache.get(llave);
    if (guardada && guardada.vence > Date.now()) return guardada.emisor;
    const emisor = await new TimbradorFacturaCom(llaves).cuenta();
    if (!emisor.regimen) {
      this.logger.warn(`factura.com dio un regimen que no esta en el catalogo para ${emisor.rfc}`);
    }
    this.cache.set(llave, { emisor, vence: Date.now() + VIGENCIA_CUENTA_MS });
    return emisor;
  }
}
