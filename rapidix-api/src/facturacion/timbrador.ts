import { ModoTimbrado, Prisma } from '@prisma/client';
import { ConceptoGuardado } from './comprobante';

/**
 * El enchufe del proveedor de timbrado. Hay dos: el simulado, que corre sin
 * llaves, y factura.com. Los dos devuelven la misma forma, asi que el servicio
 * de facturacion no lleva ningun `if (modo)`: el demo y la produccion son el
 * mismo codigo.
 */

/** El cliente, como lo pide el SAT en CFDI 4.0. */
export interface Receptor {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  usoCfdi: string;
  cpFiscal: string;
  email: string | null;
}

/** Nodo InformacionGlobal: solo lo lleva la factura a PUBLICO EN GENERAL. */
export interface InformacionGlobal {
  /** c_Periodicidad. */
  periodicidad: string;
  /** c_Meses. */
  meses: string;
  anio: number;
}

export interface SolicitudTimbrado {
  /** Folio del pedido: va como numero de orden para encontrarlo en el proveedor. */
  folioPedido: string;
  receptor: Receptor;
  conceptos: ConceptoGuardado[];
  formaPago: string;
  informacionGlobal?: InformacionGlobal;
}

export interface Timbrado {
  /** Folio fiscal. */
  uuid: string;
  proveedorId: string | null;
  serie: string | null;
  folio: string | null;
  respuesta: Prisma.InputJsonValue;
}

/** Lo que hace falta de una factura ya timbrada para volver a pintarla. */
export interface FacturaTimbrada extends Receptor {
  uuid: string;
  proveedorId: string | null;
  serie: string | null;
  folio: string | null;
  formaPago: string;
  subtotal: Prisma.Decimal;
  descuento: Prisma.Decimal;
  iva: Prisma.Decimal;
  /** Solo la de un pedido de RESICO a persona moral; la global no lleva. */
  retencionIsr?: Prisma.Decimal;
  total: Prisma.Decimal;
  conceptos: ConceptoGuardado[];
  timbradaEn: Date;
  folioPedido: string;
  informacionGlobal?: InformacionGlobal;
}

export interface Timbrador {
  readonly modo: ModoTimbrado;
  timbrar(solicitud: SolicitudTimbrado): Promise<Timbrado>;
  pdf(factura: FacturaTimbrada): Promise<Buffer>;
  xml(factura: FacturaTimbrada): Promise<Buffer>;
}

/**
 * El proveedor dijo que no: datos fiscales que el SAT rechaza, casi siempre.
 * El mensaje es del proveedor y se le ensena al cliente tal cual, porque es lo
 * unico que le dice que corregir.
 */
export class TimbradoRechazado extends Error {}

/** No se pudo hablar con el proveedor: red, caida o llaves equivocadas. */
export class ProveedorNoDisponible extends Error {}
