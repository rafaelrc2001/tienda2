import { EstadoPago, MetodoPago, Prisma, TasaIva } from '@prisma/client';
import { importeDeLinea } from '../catalogo/precios';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * Cuentas puras de la factura: de un pedido a los conceptos de un CFDI 4.0.
 *
 * El problema que resuelven: en Rapidix los precios ya incluyen el IVA y el
 * CFDI los quiere sin el, con el impuesto aparte y redondeado a centavos. Si se
 * desglosa a lo bruto (precio / 1.16) la suma de la factura se aleja centavos
 * del ticket. Aqui se busca, concepto por concepto, la base que con su IVA
 * redondeado da exactamente lo cobrado, y lo que no cuadra se arrastra.
 *
 * Probadas en `comprobante.spec.ts`.
 */

const TASA_16 = new Decimal('0.16');
const CENTAVO = new Decimal('0.01');

/** Lo que sale de la base de cada renglon. Los snapshots, no el producto de hoy. */
export interface RenglonFacturable {
  nombre: string;
  categoria: string;
  unidad: string;
  cantidad: number;
  precioUnitario: Decimal;
  tasaIva: TasaIva;
  /** c_ClaveProdServ asignada al producto. Sin ella va la generica de `ClavesSat`. */
  claveProdServ?: string | null;
  /** c_ClaveUnidad asignada al producto. Sin ella se deduce de `unidad`. */
  claveUnidad?: { clave: string; nombre: string } | null;
}

export interface PedidoFacturable {
  items: RenglonFacturable[];
  envio: Decimal;
  recargoFuera: Decimal;
  descuento: Decimal;
  total: Decimal;
  pagadoConBilletera: Decimal;
  metodoPago: MetodoPago;
}

/** Claves del catalogo del SAT que no salen del pedido. */
export interface ClavesSat {
  /** c_ClaveProdServ de los productos que no tienen una propia. */
  producto: string;
  /** c_ClaveProdServ del envio y del recargo. */
  servicio: string;
}

/**
 * Un concepto del CFDI, ya cuadrado. Los importes van sin IVA salvo `iva`.
 *
 * `importe` es `cantidad x valorUnitario` (lo que el SAT llama Importe),
 * `descuento` lo que le toca del cupon y `base = importe - descuento` es sobre
 * lo que se calcula el impuesto.
 */
export interface Concepto {
  descripcion: string;
  claveProdServ: string;
  claveUnidad: string;
  unidad: string;
  cantidad: number;
  /** Seis decimales: los que admite el SAT. */
  valorUnitario: Decimal;
  importe: Decimal;
  descuento: Decimal;
  base: Decimal;
  tasa: TasaIva;
  iva: Decimal;
  /** ISR retenido sobre `base`. Solo en la factura de RESICO a persona moral. */
  retencionIsr?: Decimal;
}

export interface Comprobante {
  conceptos: Concepto[];
  /** Suma de importes, sin IVA y antes del descuento. Es el SubTotal del CFDI. */
  subtotal: Decimal;
  descuento: Decimal;
  iva: Decimal;
  /** ISR retenido (TotalImpuestosRetenidos). Cero salvo RESICO a persona moral. */
  retencionIsr: Decimal;
  total: Decimal;
  /** c_FormaPago. */
  formaPago: string;
}

/**
 * Por que todavia no se puede facturar, o null si ya se puede.
 *
 * Solo cuenta el pago: se factura lo que esta PAGADO (el CFDI va con metodo
 * PUE, pago en una sola exhibicion), se haya entregado o no. Decision del
 * negocio: si despues una entrega parcial baja el total, el CFDI ya timbrado
 * no se corrige solo y hay que cancelarlo y emitir otro a mano.
 *
 * Pago pendiente no, ni siquiera el efectivo ya cobrado en la puerta: se
 * factura cuando Finanzas acepta el corte y el pedido pasa a PAGADO.
 *
 * Lo pagado con el monedero no se factura (`totalAFacturar`): un pedido que
 * el monedero cubrio completo no tiene importe.
 */
export function bloqueoDeFacturacion(pedido: {
  estadoPago: EstadoPago;
  total: Decimal;
  pagadoConBilletera: Decimal;
}): { codigo: string; mensaje: string } | null {
  if (pedido.estadoPago === EstadoPago.CANCELADO) {
    return { codigo: 'PEDIDO_CANCELADO', mensaje: 'Un pedido cancelado no se factura.' };
  }
  if (pedido.estadoPago !== EstadoPago.PAGADO) {
    return {
      codigo: 'PEDIDO_SIN_PAGAR',
      mensaje: 'Podrás facturar este pedido cuando quede pagado.',
    };
  }
  if (!totalAFacturar(pedido).greaterThan(0)) {
    return {
      codigo: 'PAGADO_CON_MONEDERO',
      mensaje: 'Este pedido se pagó con tu monedero: no hay importe que facturar.',
    };
  }
  return null;
}

/**
 * La unidad del producto en el catalogo c_ClaveUnidad. La unidad es texto libre
 * en el catalogo de Rapidix; lo que no se reconoce va como pieza.
 */
export function claveUnidad(unidad: string): { clave: string; nombre: string } {
  const u = unidad
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  if (['kg', 'kgs', 'kilo', 'kilos', 'kilogramo', 'kilogramos'].includes(u)) {
    return { clave: 'KGM', nombre: 'Kilogramo' };
  }
  if (['g', 'gr', 'grs', 'gramo', 'gramos'].includes(u)) return { clave: 'GRM', nombre: 'Gramo' };
  if (['l', 'lt', 'lts', 'litro', 'litros'].includes(u)) return { clave: 'LTR', nombre: 'Litro' };
  if (['ml', 'mililitro', 'mililitros'].includes(u)) return { clave: 'MLT', nombre: 'Mililitro' };
  return { clave: 'H87', nombre: 'Pieza' };
}

/** IVA de una base, redondeado a centavos como lo valida el SAT. */
export function ivaDe(base: Decimal, tasa: TasaIva): Decimal {
  return tasa === TasaIva.DIECISEIS
    ? base.mul(TASA_16).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    : new Decimal(0);
}

/**
 * La base al 16 % cuya suma con su IVA redondeado da `objetivo` (IVA incluido).
 *
 * No siempre existe: al subir la base un centavo el total sube uno o dos, asi
 * que hay montos que no se alcanzan. Entonces se toma la mas cercana y se
 * devuelve lo que falto (`resto`) para que lo absorba otro concepto. Entre
 * quedarse un centavo abajo o arriba, arriba: $7 sale en 7.01, no en 6.99.
 */
export function baseAl16(objetivo: Decimal): { base: Decimal; resto: Decimal } {
  const estimada = objetivo.div(new Decimal('1.16')).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  let mejor = {
    base: estimada,
    resto: objetivo.sub(estimada.add(ivaDe(estimada, TasaIva.DIECISEIS))),
  };
  for (let paso = -2; paso <= 2; paso++) {
    const base = estimada.add(CENTAVO.mul(paso));
    if (base.lessThan(0)) continue;
    const resto = objetivo.sub(base.add(ivaDe(base, TasaIva.DIECISEIS)));
    const masCerca = resto.abs().lessThan(mejor.resto.abs());
    const igualPeroArriba = resto.abs().equals(mejor.resto.abs()) && resto.lessThan(mejor.resto);
    if (masCerca || igualPeroArriba) mejor = { base, resto };
    if (resto.isZero()) break;
  }
  return mejor;
}

/**
 * Reparte el descuento del cupon entre los renglones, en proporcion a lo que
 * vale cada uno. El ultimo se lleva el redondeo para que la suma sea exacta.
 *
 * Si el cupon estaba atado a categorias, solo entre los renglones de esas
 * categorias: es sobre lo que se calculo (`CarritoService.validarCupon`), y
 * repartirlo en todo moveria IVA entre productos al 0 % y al 16 %.
 */
export function repartirDescuento(
  brutos: { importe: Decimal; categoria: string }[],
  descuento: Decimal,
  categoriasDelCupon: string[],
): Decimal[] {
  const partes = brutos.map(() => new Decimal(0));
  if (!descuento.greaterThan(0) || brutos.length === 0) return partes;

  let elegibles = brutos
    .map((b, i) => ({ ...b, i }))
    .filter((b) => categoriasDelCupon.length === 0 || categoriasDelCupon.includes(b.categoria));
  // Una entrega parcial pudo dejar fuera justo esas categorias; el descuento ya
  // se aplico y tiene que caer en algun renglon.
  if (elegibles.length === 0) elegibles = brutos.map((b, i) => ({ ...b, i }));

  const suma = elegibles.reduce((s, b) => s.add(b.importe), new Decimal(0));
  if (!suma.greaterThan(0)) return partes;
  // Nunca mas de lo que valen: un renglon no puede quedar en negativo.
  const aRepartir = Decimal.min(descuento, suma);

  let repartido = new Decimal(0);
  elegibles.forEach((b, n) => {
    const parte =
      n === elegibles.length - 1
        ? aRepartir.sub(repartido)
        : aRepartir.mul(b.importe).div(suma).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const acotada = Decimal.min(Decimal.max(parte, 0), b.importe);
    partes[b.i] = acotada;
    repartido = repartido.add(acotada);
  });
  return partes;
}

/**
 * El total de la factura: el del pedido al peso mas cercano. Desde .50 sube y
 * hasta .49 baja ($22.50 → $23, $22.49 → $22). Solo la factura se redondea:
 * el pedido, lo que se cobra y el corte siguen con sus centavos.
 */
export function totalFacturado(total: Decimal): Decimal {
  return total.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

/**
 * Por cuanto sale la factura de un pedido: lo que se pago aparte del
 * monedero, al peso (`totalFacturado`). $5.50 con $2 de monedero son $3.50,
 * que se facturan en $4.
 */
export function totalAFacturar(
  pedido: Pick<PedidoFacturable, 'total' | 'pagadoConBilletera'>,
): Decimal {
  return totalFacturado(Decimal.max(pedido.total.sub(pedido.pagadoConBilletera), 0));
}

/**
 * Reparte lo pagado con el monedero en partes iguales entre los renglones,
 * como el envio pero restando: $2 entre dos productos son $1 y $1. Ninguno
 * pierde mas de lo que vale (`topes`); lo que no le cabe a uno se reparte
 * parejo entre los demas. Devuelve tambien lo que no cupo en ninguno.
 */
export function repartirMonedero(
  topes: Decimal[],
  monedero: Decimal,
): { partes: Decimal[]; sobrante: Decimal } {
  const partes = topes.map(() => new Decimal(0));
  let resto = Decimal.max(monedero, 0);
  // Del que menos vale al que mas: si el chico no alcanza su parte, lo que le
  // falta se reparte entre los que siguen. El ultimo se lleva el centavo.
  const orden = topes.map((t, i) => ({ tope: Decimal.max(t, 0), i }));
  orden.sort((a, b) => a.tope.comparedTo(b.tope) || a.i - b.i);
  orden.forEach(({ tope, i }, n) => {
    const quedan = orden.length - n;
    const parejo = quedan === 1 ? resto : resto.div(quedan).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    partes[i] = Decimal.min(parejo, tope);
    resto = resto.sub(partes[i]);
  });
  return { partes, sobrante: resto };
}

/**
 * Parte el envio en partes iguales entre los renglones, sin importar lo que
 * valga cada uno: 6 de envio con dos productos son 3 y 3. El ultimo se lleva
 * el centavo que no se reparte parejo (10 entre 3 son 3.33, 3.33 y 3.34).
 */
export function repartirEnvio(renglones: number, envio: Decimal): Decimal[] {
  if (renglones === 0) return [];
  const parte = envio.div(renglones).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const partes = Array.from({ length: renglones }, () => parte);
  partes[renglones - 1] = envio.sub(parte.mul(renglones - 1));
  return partes;
}

/**
 * c_FormaPago: la del metodo del pedido. El monedero (05) nunca: lo pagado con
 * el sale como descuento de los productos, no como pago.
 */
export function formaDePago(pedido: Pick<PedidoFacturable, 'metodoPago'>): string {
  return pedido.metodoPago === MetodoPago.TRANSFERENCIA ? '03' : '01';
}

/**
 * Concepto ya desglosado. `objetivo` es lo que debe sumar con IVA (lo cobrado
 * menos su descuento, mas el arrastre de los anteriores); `bruto` lo que valia
 * antes del cupon, con IVA; `conDescuento`, si el cupon le toco.
 */
function concepto(
  datos: Pick<
    Concepto,
    'descripcion' | 'claveProdServ' | 'claveUnidad' | 'unidad' | 'cantidad' | 'tasa'
  >,
  bruto: Decimal,
  objetivo: Decimal,
  conDescuento: boolean,
): { concepto: Concepto; resto: Decimal } {
  let base: Decimal;
  let resto = new Decimal(0);
  let importe: Decimal;

  if (datos.tasa === TasaIva.DIECISEIS) {
    ({ base, resto } = baseAl16(Decimal.max(objetivo, 0)));
    importe = bruto.div(new Decimal('1.16')).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  } else {
    base = Decimal.max(objetivo, 0);
    importe = bruto;
  }
  // El descuento es lo que separa el importe de la base. Sin cupon no hay
  // descuento: el centavo de cuadre va al importe, no a un descuento fantasma.
  // Y si el arrastre dejo la base por encima del importe, el importe sube en
  // vez de llevar un descuento negativo, que el SAT rechaza.
  if (!conDescuento || base.greaterThan(importe)) importe = base;
  const valorUnitario = importe.div(datos.cantidad).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);

  return {
    concepto: {
      ...datos,
      valorUnitario,
      importe,
      descuento: importe.sub(base),
      base,
      iva: ivaDe(base, datos.tasa),
    },
    resto,
  };
}

/**
 * Los conceptos y totales del CFDI de un pedido.
 *
 * Productos con su tasa congelada y el recargo como servicio al 16 %. El envio
 * no sale como concepto: se reparte en partes iguales dentro de los productos
 * (`repartirEnvio`), con la tasa de cada uno; solo en la factura, el pedido y
 * el ticket lo siguen mostrando aparte. Sin productos que lo reciban vuelve a
 * ir como servicio. El cupon se reparte antes, solo sobre lo que valian los
 * productos: nunca toco el envio (el envio gratis se mide antes del
 * descuento). La factura es por lo pagado aparte del monedero, al peso mas
 * cercano (`totalAFacturar`): la diferencia del redondeo se suma con el envio
 * en partes iguales y el monedero se resta en partes iguales como descuento
 * (`repartirMonedero`). Solo el total queda en pesos enteros: $3 y $2.50 con
 * $2 de monedero son $3.25 y $2.75 con $1 de descuento cada uno, $4 en
 * total. Lo que no quepa en los productos sale del recargo. Primero van los conceptos
 * al 16 % y despues los de tasa 0, que absorben sin perdida el centavo que
 * aquellos no alcanzan. Si no hay ninguno al 0 %, el centavo se le pasa a otro
 * al 16 % que si lo alcance; con uno solo al 16 % puede quedar a un centavo:
 * quien llama decide si eso cuadra.
 */
export function armarComprobante(
  pedido: PedidoFacturable,
  categoriasDelCupon: string[],
  claves: ClavesSat,
): Comprobante {
  const renglones = pedido.items.filter((i) => i.cantidad > 0);
  const brutos = renglones.map((r) => ({
    importe: importeDeLinea(r.precioUnitario, r.cantidad),
    categoria: r.categoria,
  }));
  const descuentos = repartirDescuento(brutos, pedido.descuento, categoriasDelCupon);
  // Lo que separa lo pagado aparte del monedero del facturado (de -0.49 a
  // +0.50) viaja con el envio: tampoco es un producto. Sin productos no hay
  // donde ponerlo.
  const pagadoAparte = pedido.total.sub(pedido.pagadoConBilletera);
  const ajusteDelTotal =
    renglones.length > 0 ? totalAFacturar(pedido).sub(pagadoAparte) : new Decimal(0);
  const envios = repartirEnvio(renglones.length, pedido.envio.add(ajusteDelTotal));
  const antesDelMonedero = brutos.map((b, i) => b.importe.sub(descuentos[i]).add(envios[i]));
  const monedero = repartirMonedero(antesDelMonedero, pedido.pagadoConBilletera);
  const netos = antesDelMonedero.map((n, i) => n.sub(monedero.partes[i]));
  // Si el monedero cubrio mas que los productos, lo que falta sale de los
  // servicios.
  let monederoSobrante = monedero.sobrante;

  type Pendiente = {
    datos: Parameters<typeof concepto>[0];
    bruto: Decimal;
    neto: Decimal;
    orden: number;
  };
  const pendientes: Pendiente[] = renglones.map((r, i) => {
    const unidad = r.claveUnidad ?? claveUnidad(r.unidad);
    return {
      datos: {
        descripcion: r.nombre,
        claveProdServ: r.claveProdServ ?? claves.producto,
        claveUnidad: unidad.clave,
        unidad: unidad.nombre,
        cantidad: r.cantidad,
        tasa: r.tasaIva,
      },
      // El envio y el redondeo del total entran en los dos: no son
      // descuento, el producto vale eso mas (o menos). El cupon y el monedero
      // solo en el neto: son el descuento.
      bruto: brutos[i].importe.add(envios[i]),
      neto: netos[i],
      orden: i,
    };
  });

  const servicio = (descripcion: string, monto: Decimal, orden: number): Pendiente => {
    const delMonedero = Decimal.min(monederoSobrante, monto);
    monederoSobrante = monederoSobrante.sub(delMonedero);
    return {
      datos: {
        descripcion,
        claveProdServ: claves.servicio,
        claveUnidad: 'E48',
        unidad: 'Unidad de servicio',
        cantidad: 1,
        tasa: TasaIva.DIECISEIS,
      },
      bruto: monto,
      neto: monto.sub(delMonedero),
      orden,
    };
  };
  if (pedido.envio.greaterThan(0) && renglones.length === 0) {
    pendientes.push(servicio('Envío a domicilio', pedido.envio, pendientes.length));
  }
  if (pedido.recargoFuera.greaterThan(0)) {
    pendientes.push(
      servicio('Recargo por servicio fuera de horario', pedido.recargoFuera, pendientes.length),
    );
  }

  // Al 16 % primero, para que el arrastre termine en uno al 0 %.
  const enOrdenDeCuadre = [
    ...pendientes.filter((p) => p.datos.tasa === TasaIva.DIECISEIS),
    ...pendientes.filter((p) => p.datos.tasa !== TasaIva.DIECISEIS),
  ];
  const cuadrados = new Map<number, Concepto>();
  const cuadrar = (p: Pendiente, objetivo: Decimal) =>
    concepto(p.datos, p.bruto, objetivo, p.neto.lessThan(p.bruto));
  let arrastre = new Decimal(0);
  let objetivoDelUltimo = new Decimal(0);
  for (const p of enOrdenDeCuadre) {
    objetivoDelUltimo = p.neto.add(arrastre);
    const { concepto: c, resto } = cuadrar(p, objetivoDelUltimo);
    cuadrados.set(p.orden, c);
    arrastre = resto;
  }
  // Sin ninguno al 0 % el ultimo puede quedar a un centavo (un total de .99).
  // Se le pasan unos centavos a otro al 16 % (o se le quitan) hasta que los
  // dos tengan base exacta: el total no se mueve y los conceptos casi tampoco.
  if (!arrastre.isZero() && enOrdenDeCuadre.length > 1) {
    const ultimo = enOrdenDeCuadre[enOrdenDeCuadre.length - 1];
    const otros = enOrdenDeCuadre
      .slice(0, -1)
      .filter((p) => p.datos.tasa === TasaIva.DIECISEIS)
      .reverse();
    buscar: for (let centavos = 1; centavos <= 5; centavos++) {
      for (const signo of [1, -1]) {
        const paso = CENTAVO.mul(centavos * signo);
        const delUltimo = cuadrar(ultimo, objetivoDelUltimo.sub(paso));
        if (!delUltimo.resto.isZero()) continue;
        for (const p of otros) {
          const antes = cuadrados.get(p.orden)!;
          const delOtro = cuadrar(p, antes.base.add(antes.iva).add(paso));
          if (delOtro.resto.isZero()) {
            cuadrados.set(ultimo.orden, delUltimo.concepto);
            cuadrados.set(p.orden, delOtro.concepto);
            break buscar;
          }
        }
      }
    }
  }

  // En la factura se leen en el orden del pedido, con los servicios al final.
  const conceptos = pendientes.map((p) => cuadrados.get(p.orden)!);
  const sumar = (campo: 'importe' | 'descuento' | 'iva'): Decimal =>
    conceptos.reduce((s, c) => s.add(c[campo]), new Decimal(0));
  const subtotal = sumar('importe');
  const descuento = sumar('descuento');
  const iva = sumar('iva');

  return {
    conceptos,
    subtotal,
    descuento,
    iva,
    retencionIsr: new Decimal(0),
    total: subtotal.sub(descuento).add(iva),
    formaPago: formaDePago(pedido),
  };
}

/** c_RegimenFiscal 626: Regimen Simplificado de Confianza. */
export const REGIMEN_RESICO = '626';
const TASA_RETENCION_RESICO = new Decimal('0.0125');

/**
 * Si la factura lleva la retencion de ISR del RESICO: el negocio tributa en el
 * 626 como persona fisica y le factura a una persona moral, que le retiene el
 * 1.25 % (art. 113-J de la LISR). A una persona fisica o a PUBLICO EN GENERAL
 * no se le retiene nada.
 *
 * El emisor se lee de Configuracion -> Fiscal. Sin RFC capturado basta el
 * regimen; con RFC de persona moral no hay retencion aunque diga 626 (el RESICO
 * de personas morales no la lleva).
 */
export function retieneIsrResico(
  emisor: { regimen: string | null; rfc: string | null },
  rfcReceptor: string,
): boolean {
  if (emisor.regimen !== REGIMEN_RESICO) return false;
  if (emisor.rfc && emisor.rfc.trim().length === 12) return false;
  return rfcReceptor.trim().length === 12;
}

/**
 * El comprobante con la retencion del RESICO: 1.25 % de la base de cada
 * concepto, redondeado por concepto como lo valida el SAT. Los conceptos y el
 * IVA no se mueven; solo baja el total: subtotal - descuento + IVA - retencion.
 */
export function conRetencionResico(c: Comprobante): Comprobante {
  const conceptos = c.conceptos.map((x) => ({
    ...x,
    retencionIsr: x.base.mul(TASA_RETENCION_RESICO).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
  }));
  const retencionIsr = conceptos.reduce((s, x) => s.add(x.retencionIsr), new Decimal(0));
  return {
    ...c,
    conceptos,
    retencionIsr,
    total: c.subtotal.sub(c.descuento).add(c.iva).sub(retencionIsr),
  };
}

/**
 * Un concepto guardado en `facturas.conceptos`: los Decimal como texto. Los
 * guardados antes de la retencion no traen `retencionIsr`: se leen como cero.
 */
export type ConceptoGuardado = {
  [K in Exclude<keyof Concepto, 'retencionIsr'>]: Concepto[K] extends Decimal
    ? string
    : Concepto[K];
} & { retencionIsr?: string };

export function aGuardado(c: Concepto): ConceptoGuardado {
  const { retencionIsr, ...resto } = c;
  return {
    ...resto,
    valorUnitario: c.valorUnitario.toFixed(6),
    importe: c.importe.toFixed(2),
    descuento: c.descuento.toFixed(2),
    base: c.base.toFixed(2),
    iva: c.iva.toFixed(2),
    ...(retencionIsr?.greaterThan(0) && { retencionIsr: retencionIsr.toFixed(2) }),
  };
}
