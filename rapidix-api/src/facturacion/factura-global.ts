import { MetodoPago, Prisma, TasaIva } from '@prisma/client';
import { baseAl16, Concepto, ivaDe } from './comprobante';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * Cuentas puras de la factura global (Finanzas -> Bancos): los depositos de
 * quien no pidio factura se facturan juntos a PUBLICO EN GENERAL.
 *
 * El problema que resuelven: aqui no hay un pedido con precios. Hay un total
 * (lo que sumaron los depositos elegidos, con centavos) y unos productos con
 * su cantidad, y hay que ponerle precio a cada uno para que, con su IVA
 * redondeado, la factura de exactamente ese total. Se reparte el total en
 * proporcion al precio de lista de cada renglon y luego se cuadra centavo por
 * centavo como en `armarComprobante`.
 *
 * Probadas en `factura-global.spec.ts`.
 */

/**
 * El receptor de una factura global, fijo por regla del SAT (Anexo 20, guia
 * de llenado del CFDI global). No se captura ni se guarda: es siempre este.
 * El CP no va aqui porque es el del lugar de expedicion del negocio.
 */
export const PUBLICO_EN_GENERAL = {
  rfc: 'XAXX010101000',
  razonSocial: 'PUBLICO EN GENERAL',
  /** Sin obligaciones fiscales. */
  regimenFiscal: '616',
  /** Sin efectos fiscales. */
  usoCfdi: 'S01',
} as const;

export interface OpcionSat {
  clave: string;
  nombre: string;
}

/** c_Periodicidad: cada cuanto se junta lo que se factura. */
export const PERIODICIDADES: OpcionSat[] = [
  { clave: '01', nombre: 'Diario' },
  { clave: '02', nombre: 'Semanal' },
  { clave: '03', nombre: 'Quincenal' },
  { clave: '04', nombre: 'Mensual' },
  { clave: '05', nombre: 'Bimestral' },
];

const PERIODICIDAD_BIMESTRAL = '05';

/** c_Meses: del 01 al 12 un mes; del 13 al 18, los bimestres. */
export const MESES_SAT: OpcionSat[] = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
  'Enero-Febrero',
  'Marzo-Abril',
  'Mayo-Junio',
  'Julio-Agosto',
  'Septiembre-Octubre',
  'Noviembre-Diciembre',
].map((nombre, i) => ({ clave: String(i + 1).padStart(2, '0'), nombre }));

/**
 * Si el mes cabe con la periodicidad. El SAT rechaza un bimestre con
 * periodicidad mensual y al reves: mejor decirlo antes de timbrar.
 */
export function mesesCompatibles(periodicidad: string, meses: string): boolean {
  const n = Number(meses);
  if (!PERIODICIDADES.some((p) => p.clave === periodicidad)) return false;
  return periodicidad === PERIODICIDAD_BIMESTRAL ? n >= 13 && n <= 18 : n >= 1 && n <= 12;
}

/**
 * La forma de pago de la factura global: la del deposito de mayor monto, como
 * lo pide el SAT. Igual que en los pedidos, transferencia es 03 y lo demas 01.
 */
export function formaDePagoGlobal(depositos: { cantidad: Decimal; metodo: MetodoPago }[]): string {
  const mayor = depositos.reduce<(typeof depositos)[number] | null>(
    (m, d) => (m === null || d.cantidad.greaterThan(m.cantidad) ? d : m),
    null,
  );
  return mayor?.metodo === MetodoPago.TRANSFERENCIA ? '03' : '01';
}

/** Un renglon de la tabla del modal, ya resuelto contra el producto. */
export interface RenglonGlobal {
  descripcion: string;
  claveProdServ: string;
  claveUnidad: string;
  unidad: string;
  cantidad: number;
  tasa: TasaIva;
  /** Cuanto pesa en el reparto del total: el precio de lista por la cantidad. */
  peso: Decimal;
}

export type FacturaGlobalArmada =
  | { conceptos: Concepto[]; subtotal: Decimal; iva: Decimal; total: Decimal }
  | {
      /**
       * MONTO_INSUFICIENTE: el total no alcanza un centavo para cada renglon.
       * NO_CUADRA: con un solo producto al 16 % hay totales a los que no se
       * llega (base 6.03 da 6.99 y 6.04 da 7.01: $7.00 no existe).
       */
      error: 'MONTO_INSUFICIENTE' | 'NO_CUADRA';
    };

/**
 * Parte el total en proporcion a los pesos, a centavos; el ultimo se lleva lo
 * que no se reparte exacto. Si algun renglon no tiene peso (un producto con
 * precio en cero) se reparte por cantidad: un renglon en cero no se factura.
 */
export function repartirTotal(total: Decimal, pesos: Decimal[]): Decimal[] {
  const usados = pesos.every((p) => p.greaterThan(0)) ? pesos : pesos.map(() => new Decimal(1));
  const suma = usados.reduce((s, p) => s.add(p), new Decimal(0));
  let repartido = new Decimal(0);
  return usados.map((p, i) => {
    if (i === usados.length - 1) return total.sub(repartido);
    const parte = total.mul(p).div(suma).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    repartido = repartido.add(parte);
    return parte;
  });
}

/**
 * Un concepto con base exacta para `objetivo` (IVA incluido). Sin descuento:
 * el importe es la base. `resto` es lo que no se alcanzo (solo al 16 %).
 */
function conceptoGlobal(
  r: RenglonGlobal,
  objetivo: Decimal,
): { concepto: Concepto; resto: Decimal } {
  const { base, resto } =
    r.tasa === TasaIva.DIECISEIS ? baseAl16(objetivo) : { base: objetivo, resto: new Decimal(0) };
  return {
    concepto: {
      descripcion: r.descripcion,
      claveProdServ: r.claveProdServ,
      claveUnidad: r.claveUnidad,
      unidad: r.unidad,
      cantidad: r.cantidad,
      valorUnitario: base.div(r.cantidad).toDecimalPlaces(6, Decimal.ROUND_HALF_UP),
      importe: base,
      descuento: new Decimal(0),
      base,
      tasa: r.tasa,
      iva: ivaDe(base, r.tasa),
    },
    resto,
  };
}

/**
 * Los conceptos de la factura global, cuyo total (subtotal + IVA) es
 * exactamente `total`, centavos incluidos.
 *
 *  1. El total se reparte entre los renglones por su precio de lista.
 *  2. Primero los del 16 %: a cada uno se le busca la base que con su IVA
 *     redondeado da su parte; el centavo que no se alcanza pasa al siguiente.
 *  3. Despues los del 0 %, que absorben ese centavo sin perdida.
 *  4. Si todos son del 16 % y el ultimo se quedo a un centavo, se le pasan
 *     unos centavos a otro del 16 % hasta que los dos tengan base exacta.
 *
 * El precio unitario (sin IVA, seis decimales como admite el SAT) sale de la
 * base entre la cantidad.
 */
export function armarFacturaGlobal(
  total: Decimal,
  renglones: RenglonGlobal[],
): FacturaGlobalArmada {
  if (renglones.length === 0 || !total.greaterThan(0)) return { error: 'MONTO_INSUFICIENTE' };
  const objetivos = repartirTotal(
    total,
    renglones.map((r) => r.peso),
  );
  if (objetivos.some((o) => !o.greaterThan(0))) return { error: 'MONTO_INSUFICIENTE' };

  const indices = renglones.map((_, i) => i);
  const orden = [
    ...indices.filter((i) => renglones[i].tasa === TasaIva.DIECISEIS),
    ...indices.filter((i) => renglones[i].tasa !== TasaIva.DIECISEIS),
  ];
  const conceptos: Concepto[] = new Array<Concepto>(renglones.length);
  let arrastre = new Decimal(0);
  let objetivoDelUltimo = new Decimal(0);
  for (const i of orden) {
    objetivoDelUltimo = objetivos[i].add(arrastre);
    if (!objetivoDelUltimo.greaterThan(0)) return { error: 'MONTO_INSUFICIENTE' };
    const { concepto, resto } = conceptoGlobal(renglones[i], objetivoDelUltimo);
    conceptos[i] = concepto;
    arrastre = resto;
  }

  if (!arrastre.isZero()) {
    const ultimo = orden[orden.length - 1];
    const otros = orden.slice(0, -1).reverse();
    let cuadro = false;
    buscar: for (let centavos = 1; centavos <= 20; centavos++) {
      for (const signo of [1, -1]) {
        const paso = new Decimal('0.01').mul(centavos * signo);
        const delUltimo = conceptoGlobal(renglones[ultimo], objetivoDelUltimo.sub(paso));
        if (!delUltimo.resto.isZero() || !delUltimo.concepto.base.greaterThan(0)) continue;
        for (const o of otros) {
          const antes = conceptos[o];
          const delOtro = conceptoGlobal(renglones[o], antes.base.add(antes.iva).add(paso));
          if (delOtro.resto.isZero() && delOtro.concepto.base.greaterThan(0)) {
            conceptos[ultimo] = delUltimo.concepto;
            conceptos[o] = delOtro.concepto;
            cuadro = true;
            break buscar;
          }
        }
      }
    }
    if (!cuadro) return { error: 'NO_CUADRA' };
  }

  if (conceptos.some((c) => !c.base.greaterThan(0))) return { error: 'MONTO_INSUFICIENTE' };
  const subtotal = conceptos.reduce((s, c) => s.add(c.importe), new Decimal(0));
  const iva = conceptos.reduce((s, c) => s.add(c.iva), new Decimal(0));
  // Defensa: un CFDI timbrado no se deshace. Si por lo que sea no da el total
  // exacto, mejor no timbrar.
  if (!subtotal.add(iva).equals(total)) return { error: 'NO_CUADRA' };
  return { conceptos, subtotal, iva, total };
}
