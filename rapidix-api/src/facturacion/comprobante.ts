import { EstadoPago, EstadoPedido, MetodoPago, Prisma, TasaIva } from '@prisma/client';
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
}

export interface Comprobante {
  conceptos: Concepto[];
  /** Suma de importes, sin IVA y antes del descuento. Es el SubTotal del CFDI. */
  subtotal: Decimal;
  descuento: Decimal;
  iva: Decimal;
  total: Decimal;
  /** c_FormaPago. */
  formaPago: string;
}

/**
 * Por que todavia no se puede facturar, o null si ya se puede.
 *
 * Solo se factura lo cerrado: entregado (una entrega parcial ya reescribio sus
 * renglones y su total) y pagado (el CFDI va con metodo PUE, pago en una sola
 * exhibicion). Un CFDI timbrado no se corrige: facturar antes seria arriesgarse
 * a una factura por 10 y una entrega de 6.
 *
 * Pagado es tambien el efectivo entregado que sigue en PAGO_PENDIENTE: el
 * cliente le pago al repartidor en la puerta y solo falta que Finanzas acepte
 * el corte, que es cuenta entre el repartidor y el negocio. Si el repartidor
 * entrega de menos es adeudo suyo, no del cliente (`destinoAlAceptar`). La
 * transferencia pendiente no entra: ese dinero nadie lo ha visto todavia.
 */
export function bloqueoDeFacturacion(pedido: {
  estado: EstadoPedido;
  estadoPago: EstadoPago;
  metodoPago: MetodoPago;
}): { codigo: string; mensaje: string } | null {
  if (pedido.estadoPago === EstadoPago.CANCELADO) {
    return { codigo: 'PEDIDO_CANCELADO', mensaje: 'Un pedido cancelado no se factura.' };
  }
  if (pedido.estado !== EstadoPedido.ENTREGADO) {
    return {
      codigo: 'PEDIDO_SIN_ENTREGAR',
      mensaje: 'Podrás facturar este pedido cuando se haya entregado.',
    };
  }
  const cobradoEnLaPuerta =
    pedido.metodoPago === MetodoPago.EFECTIVO && pedido.estadoPago === EstadoPago.PAGO_PENDIENTE;
  if (pedido.estadoPago !== EstadoPago.PAGADO && !cobradoEnLaPuerta) {
    return {
      codigo: 'PEDIDO_SIN_PAGAR',
      mensaje: 'Podrás facturar este pedido cuando quede pagado.',
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
function ivaDe(base: Decimal, tasa: TasaIva): Decimal {
  return tasa === TasaIva.DIECISEIS
    ? base.mul(TASA_16).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    : new Decimal(0);
}

/**
 * La base al 16 % cuya suma con su IVA redondeado da `objetivo` (IVA incluido).
 *
 * No siempre existe: al subir la base un centavo el total sube uno o dos, asi
 * que hay montos que no se alcanzan. Entonces se toma la mas cercana y se
 * devuelve lo que falto (`resto`) para que lo absorba otro concepto.
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
    if (resto.abs().lessThan(mejor.resto.abs())) mejor = { base, resto };
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
 * Lo que hay que mover en cada renglon para que quede en pesos enteros, sin
 * mover el total: cada uno se redondea al peso mas cercano y el renglon
 * `absorbe` se lleva la diferencia, con los centavos que traiga el pedido.
 * 12.50 y 14.50 quedan en 13 y 14 (ajustes +0.50 y -0.50).
 *
 * Uno que redondeado quedaria en cero no se toca: un concepto en cero no es
 * una venta. Y si el que absorbe quedaria en cero o menos, no se redondea
 * nada.
 */
export function redondearAPesos(montos: Decimal[], absorbe: number): Decimal[] {
  if (absorbe < 0 || absorbe >= montos.length) return montos.map(() => new Decimal(0));
  const ajustes = montos.map((m, i) => {
    if (i === absorbe) return new Decimal(0);
    const entero = m.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    return entero.greaterThan(0) ? entero.sub(m) : new Decimal(0);
  });
  const movido = ajustes.reduce((s, a) => s.add(a), new Decimal(0));
  if (!montos[absorbe].sub(movido).greaterThan(0)) return montos.map(() => new Decimal(0));
  ajustes[absorbe] = movido.neg();
  return ajustes;
}

/**
 * c_FormaPago: la que cubrio la mayor parte del pedido. La billetera de
 * cashback es un monedero electronico (05).
 */
export function formaDePago(
  pedido: Pick<PedidoFacturable, 'total' | 'pagadoConBilletera' | 'metodoPago'>,
): string {
  const resto = pedido.total.sub(pedido.pagadoConBilletera);
  if (pedido.pagadoConBilletera.greaterThan(resto)) return '05';
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
 * descuento). Ya con su envio y su descuento, cada producto se redondea a
 * pesos enteros (`redondearAPesos`) y los centavos van a uno solo, el ultimo
 * en cuadrarse, para que caigan donde cae tambien el centavo del IVA.
 * Primero van los conceptos al 16 % y despues
 * los de tasa 0, que absorben sin perdida el centavo que aquellos no alcanzan.
 * Si no hay ninguno al 0 %, el total puede quedar a un centavo del pedido:
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
  const envios = repartirEnvio(renglones.length, pedido.envio);
  const netos = brutos.map((b, i) => b.importe.sub(descuentos[i]).add(envios[i]));
  // Absorbe el ultimo al 0 %, que es tambien el ultimo en cuadrarse.
  const ceros = renglones.map((r, i) => (r.tasaIva === TasaIva.DIECISEIS ? -1 : i));
  const absorbe = Math.max(...ceros) >= 0 ? Math.max(...ceros) : renglones.length - 1;
  const ajustes = redondearAPesos(netos, absorbe);

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
      // El envio y el redondeo entran en los dos: no son descuento, el
      // producto vale eso mas (o menos).
      bruto: brutos[i].importe.add(envios[i]).add(ajustes[i]),
      neto: netos[i].add(ajustes[i]),
      orden: i,
    };
  });

  const servicio = (descripcion: string, monto: Decimal, orden: number): Pendiente => ({
    datos: {
      descripcion,
      claveProdServ: claves.servicio,
      claveUnidad: 'E48',
      unidad: 'Unidad de servicio',
      cantidad: 1,
      tasa: TasaIva.DIECISEIS,
    },
    bruto: monto,
    neto: monto,
    orden,
  });
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
  let arrastre = new Decimal(0);
  for (const p of enOrdenDeCuadre) {
    const { concepto: c, resto } = concepto(
      p.datos,
      p.bruto,
      p.neto.add(arrastre),
      p.neto.lessThan(p.bruto),
    );
    cuadrados.set(p.orden, c);
    arrastre = resto;
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
    total: subtotal.sub(descuento).add(iva),
    formaPago: formaDePago(pedido),
  };
}

/** Un concepto guardado en `facturas.conceptos`: los Decimal como texto. */
export type ConceptoGuardado = {
  [K in keyof Concepto]: Concepto[K] extends Decimal ? string : Concepto[K];
};

export function aGuardado(c: Concepto): ConceptoGuardado {
  return {
    ...c,
    valorUnitario: c.valorUnitario.toFixed(6),
    importe: c.importe.toFixed(2),
    descuento: c.descuento.toFixed(2),
    base: c.base.toFixed(2),
    iva: c.iva.toFixed(2),
  };
}
