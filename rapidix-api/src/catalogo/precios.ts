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
 * en la primera lista, donde no hay nada que tachar.
 */
export function precioListaAnterior(p: ListasDePrecio, cantidad: number): Decimal | null {
  const listas = listasDe(p);
  const indice = indiceLista(listas, cantidad);
  return indice > 0 ? listas[indice - 1].precio : null;
}

/** "Ahorras": lo que costaria la linea al precio de venta menos lo que cuesta. */
export function ahorro(p: ListasDePrecio, cantidad: number): Decimal {
  if (cantidad < 1) return new Decimal(0);
  const diferencia = new Decimal(p.precioVenta).sub(precioUnitario(p, cantidad));
  return Decimal.max(0, diferencia.mul(cantidad));
}

/**
 * Oferta de subir a la siguiente lista (HU-10).
 *
 * Solo aparece cuando ya se lleva al menos el 80 % del piso siguiente
 * (`faltan x 5 <= piso`): ofrecer "te faltan 8" a quien lleva 2 no convence a
 * nadie y llena la tarjeta. El ahorro compara el mismo volumen —el piso de la
 * siguiente lista— a los dos precios, para aislar el efecto del descuento.
 */
export function upsell(p: ListasDePrecio, cantidad: number): Upsell | null {
  const listas = listasDe(p);
  const indice = indiceLista(listas, cantidad);
  if (indice === -1 || indice === listas.length - 1) return null;

  const actual = listas[indice];
  const siguiente = listas[indice + 1];
  const faltan = siguiente.piso - cantidad;
  if (faltan <= 0 || faltan * 5 > siguiente.piso) return null;

  return {
    faltan,
    precioSiguiente: siguiente.precio,
    ahorro: Decimal.max(0, actual.precio.sub(siguiente.precio).mul(siguiente.piso)),
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
  precioVenta: number,
  escalones: { piso: number; precio: number }[],
): string | null {
  if (escalones.length > MAX_ESCALONES) {
    return `Un producto admite como máximo ${MAX_ESCALONES} precios por volumen.`;
  }

  let pisoAnterior = 1;
  let precioAnterior = precioVenta;
  for (const [i, escalon] of escalones.entries()) {
    const lista = i + 2;
    if (!Number.isInteger(escalon.piso) || escalon.piso <= pisoAnterior) {
      return i === 0
        ? `La lista ${lista} debe empezar en 2 piezas o más.`
        : `La lista ${lista} debe empezar en más piezas que la lista ${lista - 1}.`;
    }
    if (!(escalon.precio >= 0) || escalon.precio >= precioAnterior) {
      return i === 0
        ? `El precio de la lista ${lista} debe ser menor que el precio de venta.`
        : `El precio de la lista ${lista} debe ser menor que el de la lista ${lista - 1}.`;
    }
    pisoAnterior = escalon.piso;
    precioAnterior = escalon.precio;
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
