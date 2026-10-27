import { Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * Precio escalonado (HU-08 y HU-10).
 *
 * Unico sitio donde vive esta aritmetica: el carrito, el pedido y el "repetir
 * ultimo pedido" la llaman, y la Tienda recibe el resultado ya calculado. Son
 * funciones puras para poder probarlas sin base de datos.
 *
 * Una lista es "a partir de `piso` piezas, cada pieza cuesta `precio`". La
 * lista 1 es siempre el precio de venta y arranca en la pieza 1; las listas 2
 * y 3 son opcionales. El techo de una lista es el piso de la siguiente, y
 * pasar el piso de la ultima conserva su precio: el mejor precio no se pierde.
 */

/** Los campos del producto que deciden su precio. */
export interface ListasDePrecio {
  precioVenta: Decimal;
  piso2: number | null;
  precio2: Decimal | null;
  piso3: number | null;
  precio3: Decimal | null;
}

export interface Escalon {
  piso: number;
  precio: Decimal;
}

/** Oferta "te faltan N para el siguiente precio". */
export interface Upsell {
  faltan: number;
  precioSiguiente: Decimal;
  /** Lo que ahorra el volumen de la siguiente lista al precio de esa lista. */
  ahorro: Decimal;
}

/**
 * Decimales que admite el precio de una pieza (el de venta y el de cada
 * lista). Son muchos mas que los centavos a proposito: una lista de "3 por
 * $10" es 3.333333333333333 la pieza, y con dos decimales cobraria $9.99. Es
 * la escala de las columnas de precio en la base.
 *
 * Quince es tambien hasta donde llega un numero de JSON sin perder digitos:
 * el precio viaja como `number`, y mas alla el ultimo decimal ya no es fiable.
 */
export const DECIMALES_PRECIO = 15;

/**
 * Lo que vale un renglon: precio por cantidad, ya en centavos.
 *
 * El precio puede traer mas de dos decimales, pero el dinero no: se redondea
 * aqui, renglon por renglon, para que la suma que ve el cliente sea la de los
 * importes que ve. Todo el que multiplique un precio por piezas pasa por aqui.
 */
export function importeDeLinea(precio: Decimal | number, cantidad: number): Decimal {
  return new Decimal(precio).mul(cantidad).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Listas por encima del precio de venta. Son las de la tabla del negocio. */
export const MAX_ESCALONES = 2;

/** Todas las listas del producto, empezando por el precio de venta. */
export function listasDe(p: ListasDePrecio): Escalon[] {
  const listas: Escalon[] = [{ piso: 1, precio: new Decimal(p.precioVenta) }];
  if (p.piso2 !== null && p.precio2 !== null) {
    listas.push({ piso: p.piso2, precio: new Decimal(p.precio2) });
  }
  if (p.piso3 !== null && p.precio3 !== null) {
    listas.push({ piso: p.piso3, precio: new Decimal(p.precio3) });
  }
  return listas;
}

/** Las listas de volumen, sin la del precio de venta. Es lo que viaja al catalogo. */
export function escalonesDe(p: ListasDePrecio): Escalon[] {
  return listasDe(p).slice(1);
}

/** Indice de la lista en la que cae `cantidad`. -1 si no hay ni una pieza. */
function indiceLista(listas: Escalon[], cantidad: number): number {
  if (cantidad < 1) return -1;
  let indice = 0;
  for (let i = 1; i < listas.length; i++) {
    if (cantidad >= listas[i].piso) indice = i;
  }
  return indice;
}

/** Precio de cada pieza al llevar `cantidad`. */
export function precioUnitario(p: ListasDePrecio, cantidad: number): Decimal {
  const listas = listasDe(p);
  return listas[Math.max(0, indiceLista(listas, cantidad))].precio;
}

/**
 * Precio tachado: el de la lista anterior a la que se esta cobrando. `null`
 * en la primera lista, donde no hay nada que tachar, y cuando la anterior no
 * era mas cara: las listas no tienen que bajar de precio, y tachar un precio
 * igual o menor que el que se cobra anunciaria una rebaja que no existe.
 */
export function precioListaAnterior(p: ListasDePrecio, cantidad: number): Decimal | null {
  const listas = listasDe(p);
  const indice = indiceLista(listas, cantidad);
  if (indice <= 0) return null;
  const anterior = listas[indice - 1].precio;
  return anterior.greaterThan(listas[indice].precio) ? anterior : null;
}

/** "Ahorras": lo que costaria la linea al precio de venta menos lo que cuesta. */
export function ahorro(p: ListasDePrecio, cantidad: number): Decimal {
  if (cantidad < 1) return new Decimal(0);
  const diferencia = new Decimal(p.precioVenta).sub(precioUnitario(p, cantidad));
  return Decimal.max(0, importeDeLinea(diferencia, cantidad));
}

/**
 * Oferta de subir a la siguiente lista (HU-10).
 *
 * Lo decide solo la cantidad: aparece cuando ya se lleva al menos el 85 % del
 * piso siguiente (`faltan x 20 <= piso x 3`, en enteros para no arrastrar
 * decimales), en cualquier lista. Ofrecer "te faltan 8" a quien lleva 2 no
 * convence a nadie y llena la tarjeta. El precio no lo frena, por decision del
 * negocio: si la siguiente lista no es mas barata el ahorro sale en cero y la
 * tarjeta no lo anuncia. El ahorro compara el mismo volumen —el piso de la
 * siguiente lista— a los dos precios, para aislar el efecto del descuento.
 */
export function upsell(p: ListasDePrecio, cantidad: number): Upsell | null {
  const listas = listasDe(p);
  const indice = indiceLista(listas, cantidad);
  if (indice === -1 || indice === listas.length - 1) return null;

  const actual = listas[indice];
  const siguiente = listas[indice + 1];
  const faltan = siguiente.piso - cantidad;
  if (faltan <= 0 || faltan * 20 > siguiente.piso * 3) return null;

  return {
    faltan,
    precioSiguiente: siguiente.precio,
    ahorro: Decimal.max(0, importeDeLinea(actual.precio.sub(siguiente.precio), siguiente.piso)),
  };
}

/**
 * Comprueba unas listas de volumen antes de guardarlas. Devuelve el motivo
 * del rechazo o `null` si valen.
 *
 * Es la misma regla que los CHECK de la migracion, dicha antes de llegar a la
 * base: asi el panel y la importacion explican que esta mal en vez de
 * estrellarse contra una restriccion.
 */
export function validarEscalones(
  _precioVenta: number,
  escalones: { piso: number; precio: number }[],
): string | null {
  if (escalones.length > MAX_ESCALONES) {
    return `Un producto admite como máximo ${MAX_ESCALONES} precios por volumen.`;
  }

  let pisoAnterior = 1;
  for (const [i, escalon] of escalones.entries()) {
    const lista = i + 2;
    if (!Number.isInteger(escalon.piso) || escalon.piso <= pisoAnterior) {
      return i === 0
        ? `La lista ${lista} debe empezar en 2 piezas o más.`
        : `La lista ${lista} debe empezar en más piezas que la lista ${lista - 1}.`;
    }
    // El precio de cada lista lo pone el negocio: no tiene que bajar respecto
    // a la anterior. Solo no puede ser negativo.
    if (!(escalon.precio >= 0)) {
      return `El precio de la lista ${lista} no puede ser negativo.`;
    }
    pisoAnterior = escalon.piso;
  }
  return null;
}

/** Las listas de volumen como columnas del producto. */
export function escalonesAColumnas(escalones: { piso: number; precio: number }[]): {
  piso2: number | null;
  precio2: number | null;
  piso3: number | null;
  precio3: number | null;
} {
  return {
    piso2: escalones[0]?.piso ?? null,
    precio2: escalones[0]?.precio ?? null,
    piso3: escalones[1]?.piso ?? null,
    precio3: escalones[1]?.precio ?? null,
  };
}
