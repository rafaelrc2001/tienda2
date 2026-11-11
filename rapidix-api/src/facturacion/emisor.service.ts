import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ModoTimbrado } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { REGIMENES_FISCALES } from './catalogos-sat';
import {
  ConfigFacturaCom,
  configFacturaComDesdeEntorno,
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

/** Configuracion -> Fiscal -> Emisor: con que y a nombre de quien se factura. */
export interface EmisorServidorDto {
  modo: ModoTimbrado;
  /** Entorno de factura.com. Null en modo simulado. */
  entorno: 'PRODUCCION' | 'SANDBOX' | null;
  /** Null si no se pudo leer la cuenta de factura.com (ver `error`). */
  emisor: {
    rfc: string;
    nombre: string;
    regimen: string | null;
    regimenNombre: string | null;
    cp: string | null;
  } | null;
  error: string | null;
}

/** Los datos de la cuenta casi nunca cambian: no se piden en cada factura. */
const VIGENCIA_CUENTA_MS = 10 * 60 * 1000;

/**
 * De donde sale el emisor de cada factura: las llaves de factura.com del
 * servidor (`FACTURACOM_*`) y los datos fiscales de esa misma cuenta.
 *
 * DECISION: un solo emisor, el de las llaves del servidor. Antes cada razon
 * social de Configuracion -> Fiscal traia sus datos capturados a mano y el
 * punto de venta elegia entre ellas; los datos capturados se separaron de la
 * cuenta que de verdad sellaba (otro RFC y otro regimen en pantalla, y sin la
 * retencion del RESICO que si correspondia). factura.com sella con el CSD de
 * la cuenta de las llaves, asi que el emisor se lee de ella y no se captura.
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
  private cache: { llave: string; emisor: EmisorDeCuenta; vence: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Con que se timbra hoy. No llama a nadie: solo mira si hay llaves. */
  modo(): ModoTimbrado {
    return configFacturaComDesdeEntorno() ? ModoTimbrado.FACTURA_COM : ModoTimbrado.SIMULADO;
  }

  /**
   * El emisor de toda factura nueva. Con llaves, el de la cuenta de
   * factura.com; si no se puede leer, 502: timbrar tampoco se podria.
   */
  async actual(): Promise<EmisorElegido> {
    const llaves = configFacturaComDesdeEntorno();
    if (!llaves) return { ...emisorDesdeEntorno(), facturaCom: null };
    try {
      return { ...(await this.cuentaDe(llaves)), facturaCom: llaves };
    } catch (fallo) {
      this.logger.error(`No se leyo la cuenta de factura.com: ${String(fallo)}`);
      throw new BadGatewayException({
        statusCode: 502,
        code: 'PROVEEDOR_NO_DISPONIBLE',
        message: 'No pudimos conectar con el servicio de facturación. Inténtalo en unos minutos.',
      });
    }
  }

  /** Lo que ensena Configuracion -> Fiscal. No lanza: el fallo va en `error`. */
  async vista(): Promise<EmisorServidorDto> {
    const llaves = configFacturaComDesdeEntorno();
    const entorno = llaves ? (llaves.sandbox ? 'SANDBOX' : 'PRODUCCION') : null;
    let emisor: { rfc: string; nombre: string; regimen: string | null; cp: string | null };
    try {
      emisor = llaves ? await this.cuentaDe(llaves) : emisorDesdeEntorno();
    } catch (fallo) {
      return {
        modo: this.modo(),
        entorno,
        emisor: null,
        error: fallo instanceof Error ? fallo.message : String(fallo),
      };
    }
    return {
      modo: this.modo(),
      entorno,
      emisor: {
        ...emisor,
        regimenNombre: REGIMENES_FISCALES.find((r) => r.clave === emisor.regimen)?.nombre ?? null,
      },
      error: null,
    };
  }

  /**
   * Las llaves con las que se piden el PDF y el XML de una factura ya timbrada
   * en factura.com. Las de antes de este cambio pudieron timbrarse con las
   * llaves propias de una razon social: esas se siguen usando. Las demas, las
   * del servidor.
   */
  async llavesParaDocumentos(razonSocialId: string | null): Promise<ConfigFacturaCom | null> {
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
    return configFacturaComDesdeEntorno();
  }

  /** La cuenta de esas llaves, de memoria mientras siga vigente. */
  private async cuentaDe(llaves: ConfigFacturaCom): Promise<EmisorDeCuenta> {
    const llave = `${llaves.sandbox ? 's' : 'p'}:${llaves.apiKey}`;
    if (this.cache && this.cache.llave === llave && this.cache.vence > Date.now()) {
      return this.cache.emisor;
    }
    const emisor = await new TimbradorFacturaCom(llaves).cuenta();
    if (!emisor.regimen) {
      this.logger.warn(`factura.com dio un regimen que no esta en el catalogo para ${emisor.rfc}`);
    }
    this.cache = { llave, emisor, vence: Date.now() + VIGENCIA_CUENTA_MS };
    return emisor;
  }
}
