import { Logger } from '@nestjs/common';
import { ModoTimbrado, TasaIva } from '@prisma/client';
import {
  FacturaTimbrada,
  ProveedorNoDisponible,
  Receptor,
  SolicitudTimbrado,
  Timbrado,
  Timbrador,
  TimbradoRechazado,
} from './timbrador';

/** Las llaves de factura.com. Sin las tres, la API timbra en modo simulado. */
export interface ConfigFacturaCom {
  apiKey: string;
  secretKey: string;
  /** El id numerico de la serie, del panel de factura.com (Configuraciones > Series). */
  serie: string;
  sandbox: boolean;
}

export function configFacturaComDesdeEntorno(): ConfigFacturaCom | null {
  const apiKey = process.env.FACTURACOM_API_KEY?.trim();
  const secretKey = process.env.FACTURACOM_SECRET_KEY?.trim();
  const serie = process.env.FACTURACOM_SERIE?.trim();
  if (!apiKey || !secretKey || !serie) return null;
  return {
    apiKey,
    secretKey,
    serie,
    // Sandbox salvo que se pida produccion a proposito: unas llaves de
    // produccion contra el sandbox fallan ruidosamente, al reves se timbraria
    // de verdad sin querer.
    sandbox: process.env.FACTURACOM_ENTORNO?.trim().toLowerCase() !== 'produccion',
  };
}

/** Valor fijo que factura.com pide en todas las peticiones (Primeros pasos). */
const F_PLUGIN = '9d4095c8f7ed5785cb14c0e3b033eeb8252416ed';
const ESPERA_MS = 30_000;

/**
 * Timbrado con factura.com (API v4, CFDI 4.0).
 *
 * El receptor no va dentro del CFDI sino como cliente de la cuenta: se busca
 * por RFC y se da de alta o se actualiza antes de timbrar. Actualizarlo
 * siempre es a proposito: el SAT valida nombre, regimen y CP contra la
 * constancia, y un cliente guardado con datos viejos haria fallar el timbre.
 *
 * Documentacion: https://factura.com/apidocs/
 */
export class TimbradorFacturaCom implements Timbrador {
  readonly modo = ModoTimbrado.FACTURA_COM;
  private readonly logger = new Logger(TimbradorFacturaCom.name);
  private readonly base: string;

  constructor(private readonly config: ConfigFacturaCom) {
    this.base = config.sandbox ? 'https://sandbox.factura.com/api' : 'https://api.factura.com';
  }

  async timbrar(solicitud: SolicitudTimbrado): Promise<Timbrado> {
    const uid = await this.clienteUid(solicitud.receptor);

    const cuerpo = {
      Receptor: { UID: uid },
      TipoDocumento: 'factura',
      UsoCFDI: solicitud.receptor.usoCfdi,
      Serie: Number(this.config.serie),
      FormaPago: solicitud.formaPago,
      // Solo se factura lo pagado: siempre es pago en una sola exhibicion.
      MetodoPago: 'PUE',
      Moneda: 'MXN',
      // factura.com le manda el PDF y el XML al correo del receptor.
      EnviarCorreo: Boolean(solicitud.receptor.email),
      NumOrder: solicitud.folioPedido,
      // Factura global a PUBLICO EN GENERAL: el SAT exige el periodo que cubre.
      ...(solicitud.informacionGlobal && {
        InformacionGlobal: {
          Periodicidad: solicitud.informacionGlobal.periodicidad,
          Meses: solicitud.informacionGlobal.meses,
          Año: String(solicitud.informacionGlobal.anio),
        },
      }),
      Conceptos: solicitud.conceptos.map((c) => ({
        ClaveProdServ: c.claveProdServ,
        Cantidad: c.cantidad,
        ClaveUnidad: c.claveUnidad,
        Unidad: c.unidad,
        ValorUnitario: Number(c.valorUnitario),
        Descripcion: c.descripcion,
        ObjetoImp: '02',
        ...(Number(c.descuento) > 0 && { Descuento: Number(c.descuento) }),
        Impuestos: {
          Traslados: [
            {
              Base: Number(c.base),
              Impuesto: '002',
              TipoFactor: 'Tasa',
              TasaOCuota: c.tasa === TasaIva.DIECISEIS ? '0.16' : '0.00',
              Importe: Number(c.iva),
            },
          ],
        },
      })),
    };

    const respuesta = await this.peticion('POST', '/v4/cfdi40/create', cuerpo);
    if (respuesta.response !== 'success') throw rechazo(respuesta);
    const uuid = texto(respuesta.UUID) ?? texto((respuesta.SAT as Datos | undefined)?.UUID);
    if (!uuid) {
      // Timbro pero no dijo con que folio: no se puede guardar a ciegas.
      this.logger.error(
        `factura.com no devolvio UUID para ${solicitud.folioPedido}`,
        JSON.stringify(respuesta),
      );
      throw new ProveedorNoDisponible('El proveedor no devolvió el folio fiscal.');
    }
    const inv = respuesta.INV as Datos | undefined;
    return {
      uuid,
      proveedorId: texto(respuesta.uid) ?? texto(respuesta.invoice_uid),
      serie: texto(inv?.Serie),
      folio: texto(inv?.Folio),
      respuesta: respuesta as object,
    };
  }

  pdf(factura: FacturaTimbrada): Promise<Buffer> {
    return this.documento(factura, 'pdf');
  }

  xml(factura: FacturaTimbrada): Promise<Buffer> {
    return this.documento(factura, 'xml');
  }

  /** El UID del receptor en la cuenta: lo actualiza si ya existe, si no lo da de alta. */
  private async clienteUid(receptor: Receptor): Promise<string> {
    const datos = {
      rfc: receptor.rfc,
      razons: receptor.razonSocial,
      codpos: receptor.cpFiscal,
      // factura.com lo exige para dar de alta al cliente; el DTO lo pide.
      email: receptor.email ?? '',
      regimen: receptor.regimenFiscal,
      usocfdi: receptor.usoCfdi,
      pais: 'MEX',
    };

    const existente = await this.peticion('GET', `/v1/clients/${encodeURIComponent(receptor.rfc)}`);
    const uidExistente =
      existente.status === 'success' ? texto((existente.Data as Datos | undefined)?.UID) : null;

    const respuesta = uidExistente
      ? await this.peticion('POST', `/v1/clients/${uidExistente}/update`, datos)
      : await this.peticion('POST', '/v1/clients/create', datos);
    const uid = texto((respuesta.Data as Datos | undefined)?.UID) ?? uidExistente;
    if (respuesta.status !== 'success' || !uid) throw rechazo(respuesta);
    return uid;
  }

  /**
   * PDF o XML de un CFDI por su UID. La documentacion no dice si llega en
   * binario o en base64 dentro de un JSON, asi que se aceptan los dos.
   */
  private async documento(factura: FacturaTimbrada, formato: 'pdf' | 'xml'): Promise<Buffer> {
    const id = factura.proveedorId ?? factura.uuid;
    let respuesta: Response;
    try {
      respuesta = await fetch(`${this.base}/v4/cfdi40/${encodeURIComponent(id)}/${formato}`, {
        headers: this.cabeceras(),
        signal: AbortSignal.timeout(ESPERA_MS),
      });
    } catch (fallo) {
      throw new ProveedorNoDisponible(`No se pudo descargar el ${formato}: ${String(fallo)}`);
    }
    if (!respuesta.ok) {
      throw new ProveedorNoDisponible(
        `factura.com respondió ${respuesta.status} al pedir el ${formato}.`,
      );
    }

    const tipo = respuesta.headers.get('content-type') ?? '';
    const bytes = Buffer.from(await respuesta.arrayBuffer());
    if (!tipo.includes('json')) return bytes;

    const cuerpo = JSON.parse(bytes.toString('utf8')) as Datos;
    const base64 = [cuerpo.data, cuerpo.file, cuerpo[formato]].map(texto).find(Boolean);
    if (!base64) throw new ProveedorNoDisponible(mensajeDeError(cuerpo));
    return Buffer.from(base64, 'base64');
  }

  private cabeceras(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'F-PLUGIN': F_PLUGIN,
      'F-Api-Key': this.config.apiKey,
      'F-Secret-Key': this.config.secretKey,
    };
  }

  private async peticion(metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<Datos> {
    let respuesta: Response;
    try {
      respuesta = await fetch(`${this.base}${ruta}`, {
        method: metodo,
        headers: this.cabeceras(),
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(ESPERA_MS),
      });
    } catch (fallo) {
      throw new ProveedorNoDisponible(`No se pudo conectar con factura.com: ${String(fallo)}`);
    }
    // Un 401/403 son llaves malas o API apagada en el panel: no es culpa del
    // cliente, asi que no se le ensena como rechazo de sus datos.
    if (respuesta.status === 401 || respuesta.status === 403 || respuesta.status >= 500) {
      throw new ProveedorNoDisponible(`factura.com respondió ${respuesta.status} en ${ruta}.`);
    }
    try {
      return (await respuesta.json()) as Datos;
    } catch {
      // Buscar un RFC que la cuenta no tiene puede ser un 404 sin cuerpo: es
      // un "no existe", no una caida.
      if (respuesta.status === 404) return { status: 'error', message: 'No encontrado' };
      throw new ProveedorNoDisponible(`factura.com respondió algo que no es JSON en ${ruta}.`);
    }
  }
}

type Datos = Record<string, unknown>;

function texto(valor: unknown): string | null {
  if (typeof valor === 'string' && valor.trim()) return valor.trim();
  if (typeof valor === 'number') return String(valor);
  return null;
}

/**
 * El mensaje de error de factura.com viene en formas distintas segun el
 * endpoint: cadena, `{ message }` del SAT o un mapa de campo -> errores.
 */
function mensajeDeError(cuerpo: Datos): string {
  const m = cuerpo.message;
  if (typeof m === 'string' && m.trim()) return limpiar(m);
  if (m && typeof m === 'object') {
    const anidado = (m as Datos).message;
    if (typeof anidado === 'string' && anidado.trim()) return limpiar(anidado);
    const porCampo = Object.values(m as Datos)
      .flat()
      .filter((x): x is string => typeof x === 'string');
    if (porCampo.length > 0) return limpiar(porCampo.join(' '));
  }
  return 'El proveedor de facturación rechazó la solicitud.';
}

/**
 * Algunos mensajes llegan con HTML (`<strong>`) y con los acentos en UTF-8
 * leido como Latin-1 ("facturaciÃ³n"): se le quita lo uno y se repara lo otro
 * antes de ensenarlo.
 */
function limpiar(mensaje: string): string {
  const sinHtml = mensaje
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/Ã.|Â./.test(sinHtml)) return sinHtml;
  const reparado = Buffer.from(sinHtml, 'latin1').toString('utf8');
  return reparado.includes('�') ? sinHtml : reparado;
}

/**
 * Rechazos que son de la cuenta de Rapidix, no de los datos del cliente: sin
 * sello digital cargado, sin timbres... El cliente no puede corregirlos, asi
 * que van como proveedor no disponible y el detalle se queda en el log.
 */
function esProblemaDeLaCuenta(mensaje: string): boolean {
  return /archivos de facturaci|certificado|sin timbres|saldo insuficiente|cuenta/i.test(
    mensaje.normalize('NFD').replace(/\p{Diacritic}/gu, ''),
  );
}

/** El rechazo, clasificado: lo que el cliente puede corregir y lo que no. */
function rechazo(cuerpo: Datos): Error {
  const mensaje = mensajeDeError(cuerpo);
  return esProblemaDeLaCuenta(mensaje)
    ? new ProveedorNoDisponible(`Cuenta de factura.com: ${mensaje}`)
    : new TimbradoRechazado(mensaje);
}
