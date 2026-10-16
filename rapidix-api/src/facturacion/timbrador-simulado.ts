import { randomUUID } from 'node:crypto';
import { ModoTimbrado, Prisma, TasaIva } from '@prisma/client';
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import { REGIMENES_FISCALES, USOS_CFDI } from './catalogos-sat';
import { FacturaTimbrada, SolicitudTimbrado, Timbrado, Timbrador } from './timbrador';

/** El emisor del documento simulado. En factura.com vive en el panel de la cuenta. */
export interface Emisor {
  rfc: string;
  nombre: string;
  regimen: string;
  cp: string;
}

/**
 * El RFC de pruebas que el SAT publica con sus certificados de sello (EKU). Es
 * el mismo que usan los sandbox de los proveedores.
 */
export function emisorDesdeEntorno(): Emisor {
  return {
    rfc: process.env.FACTURACION_EMISOR_RFC?.trim() || 'EKU9003173C9',
    nombre: process.env.FACTURACION_EMISOR_NOMBRE?.trim() || 'ESCUELA KEMPER URGATE',
    regimen: process.env.FACTURACION_EMISOR_REGIMEN?.trim() || '601',
    cp: process.env.FACTURACION_EMISOR_CP?.trim() || '42501',
  };
}

const LEYENDA = 'CFDI SIMULADO — no tiene validez fiscal';

const FORMAS_DE_PAGO: Record<string, string> = {
  '01': 'Efectivo',
  '03': 'Transferencia electrónica de fondos',
  '05': 'Monedero electrónico',
};

/**
 * Timbrado sin proveedor: un UUID al azar y documentos armados aqui.
 *
 * Es el modo en que corre la API mientras no hay llaves de factura.com, para
 * poder probar el flujo completo en una demo. No llama a nadie. La leyenda de
 * simulado va en el PDF y en el XML a proposito: es lo unico que impide
 * confundir un documento de prueba con un comprobante real.
 */
export class TimbradorSimulado implements Timbrador {
  readonly modo = ModoTimbrado.SIMULADO;

  constructor(private readonly emisor: Emisor = emisorDesdeEntorno()) {}

  timbrar(solicitud: SolicitudTimbrado): Promise<Timbrado> {
    return Promise.resolve({
      uuid: randomUUID().toUpperCase(),
      proveedorId: null,
      serie: 'SIM',
      folio: solicitud.folioPedido,
      respuesta: { simulado: true, generado: new Date().toISOString() },
    });
  }

  xml(f: FacturaTimbrada): Promise<Buffer> {
    const a = escaparXml;
    const conceptos = f.conceptos
      .map((c) => {
        const tasa = c.tasa === TasaIva.DIECISEIS ? '0.160000' : '0.000000';
        const descuento = Number(c.descuento) > 0 ? ` Descuento="${c.descuento}"` : '';
        return (
          `    <cfdi:Concepto ClaveProdServ="${a(c.claveProdServ)}" Cantidad="${c.cantidad}" ` +
          `ClaveUnidad="${a(c.claveUnidad)}" Unidad="${a(c.unidad)}" Descripcion="${a(c.descripcion)}" ` +
          `ValorUnitario="${c.valorUnitario}" Importe="${c.importe}"${descuento} ObjetoImp="02">\n` +
          `      <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="${c.base}" Impuesto="002" ` +
          `TipoFactor="Tasa" TasaOCuota="${tasa}" Importe="${c.iva}"/></cfdi:Traslados></cfdi:Impuestos>\n` +
          `    </cfdi:Concepto>`
        );
      })
      .join('\n');
    const descuento = f.descuento.greaterThan(0) ? ` Descuento="${f.descuento.toFixed(2)}"` : '';

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${LEYENDA} -->
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Serie="${a(f.serie ?? '')}" Folio="${a(f.folio ?? '')}" Fecha="${fechaCfdi(f.timbradaEn)}" FormaPago="${a(f.formaPago)}" MetodoPago="PUE" SubTotal="${f.subtotal.toFixed(2)}"${descuento} Moneda="MXN" Total="${f.total.toFixed(2)}" TipoDeComprobante="I" Exportacion="01" LugarExpedicion="${a(this.emisor.cp)}">
  <cfdi:Emisor Rfc="${a(this.emisor.rfc)}" Nombre="${a(this.emisor.nombre)}" RegimenFiscal="${a(this.emisor.regimen)}"/>
  <cfdi:Receptor Rfc="${a(f.rfc)}" Nombre="${a(f.razonSocial)}" DomicilioFiscalReceptor="${a(f.cpFiscal)}" RegimenFiscalReceptor="${a(f.regimenFiscal)}" UsoCFDI="${a(f.usoCfdi)}"/>
  <cfdi:Conceptos>
${conceptos}
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="${f.iva.toFixed(2)}"/>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital Version="1.1" UUID="${a(f.uuid)}" FechaTimbrado="${fechaCfdi(f.timbradaEn)}" RfcProvCertif="SIMULADO" NoCertificadoSAT="00000000000000000000"/>
  </cfdi:Complemento>
</cfdi:Comprobante>
`;
    return Promise.resolve(Buffer.from(xml, 'utf8'));
  }

  async pdf(f: FacturaTimbrada): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const normal = await doc.embedFont(StandardFonts.Helvetica);
    const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
    const lienzo = new Lienzo(doc, normal, negrita);

    lienzo.texto(LEYENDA.toUpperCase(), { negrita: true, tamano: 11, color: ROJO });
    lienzo.salto(6);
    lienzo.texto('Factura', { negrita: true, tamano: 18 });
    lienzo.texto(`Serie ${f.serie ?? ''}  ·  Folio ${f.folio ?? ''}  ·  Pedido ${f.folioPedido}`);
    lienzo.texto(`Folio fiscal (UUID): ${f.uuid}`);
    lienzo.texto(`Fecha: ${fechaCfdi(f.timbradaEn)}`);
    lienzo.salto(10);

    lienzo.texto('Emisor', { negrita: true });
    lienzo.texto(`${this.emisor.nombre}  ·  RFC ${this.emisor.rfc}`);
    lienzo.texto(
      `Régimen ${nombreRegimen(this.emisor.regimen)}  ·  Lugar de expedición ${this.emisor.cp}`,
    );
    lienzo.salto(8);
    lienzo.texto('Receptor', { negrita: true });
    lienzo.texto(`${f.razonSocial}  ·  RFC ${f.rfc}`);
    lienzo.texto(`Régimen ${nombreRegimen(f.regimenFiscal)}  ·  CP ${f.cpFiscal}`);
    lienzo.texto(`Uso del CFDI: ${nombreUso(f.usoCfdi)}`);
    lienzo.texto(
      `Forma de pago: ${f.formaPago} ${FORMAS_DE_PAGO[f.formaPago] ?? ''}  ·  Método: PUE Pago en una sola exhibición`,
    );
    lienzo.salto(12);

    const columnas = [
      { titulo: 'Cant.', x: 0, ancho: 34, derecha: true },
      { titulo: 'Unidad', x: 40, ancho: 60 },
      { titulo: 'Descripción', x: 104, ancho: 170 },
      { titulo: 'P. unitario', x: 278, ancho: 62, derecha: true },
      { titulo: 'Importe', x: 344, ancho: 56, derecha: true },
      { titulo: 'Desc.', x: 404, ancho: 44, derecha: true },
      { titulo: 'IVA', x: 452, ancho: 60, derecha: true },
    ];
    lienzo.fila(
      columnas.map((c) => ({ ...c, valor: c.titulo })),
      true,
    );
    for (const c of f.conceptos) {
      lienzo.fila(
        [
          String(c.cantidad),
          `${c.claveUnidad} ${c.unidad}`,
          c.descripcion,
          dinero(c.valorUnitario),
          dinero(c.importe),
          Number(c.descuento) > 0 ? dinero(c.descuento) : '',
          `${c.tasa === TasaIva.DIECISEIS ? '16%' : '0%'} ${dinero(c.iva)}`,
        ].map((valor, i) => ({ ...columnas[i], valor })),
        false,
      );
    }
    lienzo.salto(12);

    const totales: [string, Prisma.Decimal][] = [
      ['Subtotal', f.subtotal],
      ['Descuento', f.descuento],
      ['IVA trasladado', f.iva],
      ['Total', f.total],
    ];
    for (const [etiqueta, monto] of totales) {
      lienzo.fila(
        [
          { x: 344, ancho: 100, derecha: true, valor: etiqueta },
          { x: 452, ancho: 60, derecha: true, valor: dinero(monto) },
        ],
        etiqueta === 'Total',
      );
    }
    lienzo.salto(20);
    lienzo.texto(LEYENDA, { tamano: 8, color: ROJO });

    return Buffer.from(await doc.save());
  }
}

// ----------------------------------------------------------------
// Ayudas del documento
// ----------------------------------------------------------------

const ROJO = rgb(0.75, 0.12, 0.12);
const MARGEN = 42;
const ALTO = 842;
const ANCHO = 595;

/**
 * Un cursor que escribe de arriba abajo y abre otra pagina al llegar al pie.
 * Lo justo para un comprobante: lineas de texto y filas de tabla.
 */
class Lienzo {
  private pagina: PDFPage;
  private y = ALTO - MARGEN;

  constructor(
    private readonly doc: PDFDocument,
    private readonly normal: PDFFont,
    private readonly negrita: PDFFont,
  ) {
    this.pagina = doc.addPage([ANCHO, ALTO]);
  }

  salto(puntos: number): void {
    this.y -= puntos;
  }

  texto(
    valor: string,
    opciones: { negrita?: boolean; tamano?: number; color?: ReturnType<typeof rgb> } = {},
  ): void {
    const tamano = opciones.tamano ?? 9;
    this.asegurar(tamano + 4);
    this.pagina.drawText(latin1(valor), {
      x: MARGEN,
      y: this.y,
      size: tamano,
      font: opciones.negrita ? this.negrita : this.normal,
      color: opciones.color ?? rgb(0.1, 0.1, 0.1),
    });
    this.y -= tamano + 4;
  }

  fila(
    celdas: { x: number; ancho: number; derecha?: boolean; valor: string }[],
    destacada: boolean,
  ): void {
    const tamano = 8;
    this.asegurar(tamano + 6);
    const fuente = destacada ? this.negrita : this.normal;
    for (const celda of celdas) {
      const texto = recortar(latin1(celda.valor), fuente, tamano, celda.ancho);
      const ancho = fuente.widthOfTextAtSize(texto, tamano);
      this.pagina.drawText(texto, {
        x: MARGEN + celda.x + (celda.derecha ? celda.ancho - ancho : 0),
        y: this.y,
        size: tamano,
        font: fuente,
      });
    }
    this.y -= tamano + 6;
  }

  private asegurar(alto: number): void {
    if (this.y - alto >= MARGEN) return;
    this.pagina = this.doc.addPage([ANCHO, ALTO]);
    this.y = ALTO - MARGEN;
  }
}

/** Helvetica estandar solo codifica Latin-1: lo que no cabe se cambia por "?". */
function latin1(texto: string): string {
  return texto.replace(/[—–]/g, '-').replace(/[^\x20-\x7E -ÿ]/g, '?');
}

function recortar(texto: string, fuente: PDFFont, tamano: number, ancho: number): string {
  if (fuente.widthOfTextAtSize(texto, tamano) <= ancho) return texto;
  let corto = texto;
  while (corto.length > 1 && fuente.widthOfTextAtSize(`${corto}...`, tamano) > ancho) {
    corto = corto.slice(0, -1);
  }
  return `${corto}...`;
}

function dinero(valor: string | Prisma.Decimal): string {
  const n = new Prisma.Decimal(valor);
  return `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** El formato del atributo Fecha del CFDI: hora local de Mexico, sin zona. */
function fechaCfdi(fecha: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .format(fecha)
    .replace(' ', 'T');
}

function nombreRegimen(clave: string): string {
  const r = REGIMENES_FISCALES.find((x) => x.clave === clave);
  return r ? `${clave} ${r.nombre}` : clave;
}

function nombreUso(clave: string): string {
  const u = USOS_CFDI.find((x) => x.clave === clave);
  return u ? `${clave} ${u.nombre}` : clave;
}

function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
