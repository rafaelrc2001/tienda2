import { EstadoPago, EstadoPedido, MotivoDevolucion, Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * Lo que la pantalla de Rutas le cuenta al repartidor sobre su dia: cuantos
 * pedidos entrego, cuantos regresan, que baja del camion y cuanto debe aun.
 *
 * Funciones puras, sin base de datos, igual que `alcance-del-corte.ts`: aqui
 * viven las definiciones que el repartidor ve escritas (que es "devolucion",
 * que es "entregado") para que la pestana de Liquidacion y la de Historial no
 * puedan decir cosas distintas del mismo pedido.
 */

/** Lo minimo de un pedido para clasificarlo. */
export interface PedidoClasificable {
  estado: EstadoPedido;
  estadoPago: EstadoPago;
}

/**
 * Si el pedido regresa a bodega en vez de contar como entregado.
 *
 * Cancelado, o se quedo arriba del camion (Recolectado o En ruta) al cortar.
 * El cancelado va por `estadoPago` y no por `estado`: cancelar no mueve la
 * caja, y el estado fisico es el que decide el inventario.
 */
export function esDevolucion(pedido: PedidoClasificable): boolean {
  if (pedido.estadoPago === EstadoPago.CANCELADO) return true;
  return pedido.estado === EstadoPedido.RECOLECTADO || pedido.estado === EstadoPedido.EN_RUTA;
}

/**
 * Entregado y vivo. No es el complemento de `esDevolucion`: un pedido
 * cancelado tampoco se entrego, pero no es lo mismo que uno que se quedo en el
 * camion.
 */
export function esEntregado(pedido: PedidoClasificable): boolean {
  return pedido.estado === EstadoPedido.ENTREGADO && pedido.estadoPago !== EstadoPago.CANCELADO;
}

export interface IndicadoresDeRuta {
  pedidos: number;
  entregados: number;
  devoluciones: number;
}

/**
 * Las cuentas del encabezado. `entregados + devoluciones` puede no dar el
 * total, y esta bien: un pedido entregado y luego cancelado es devolucion por
 * su dinero, pero no volvio en el camion.
 */
export function indicadoresDeRuta(pedidos: PedidoClasificable[]): IndicadoresDeRuta {
  return {
    pedidos: pedidos.length,
    entregados: pedidos.filter(esEntregado).length,
    devoluciones: pedidos.filter(esDevolucion).length,
  };
}

// ------------------------------------------------------------------
// Piezas
// ------------------------------------------------------------------

/** Un renglon del camion con el nombre de lo que lleva. */
export interface RenglonConProducto {
  productoId: string;
  nombre: string;
  unidad: string;
  cantidadCargada: number;
  /** Lo que el cliente acepto. Cero mientras el pedido no se entregue. */
  cantidadEntregada: number;
}

export interface ConteoDeProducto {
  productoId: string;
  nombre: string;
  unidad: string;
  /** Lo que subio al camion. */
  cargado: number;
  /** Lo que se quedo con los clientes. */
  entregado: number;
  /** Lo que baja del camion: `cargado - entregado`, siempre. */
  devolucion: number;
}

/**
 * El conteo fisico de lo que baja del camion, por producto y sumando todos
 * los pedidos: el desglose por pedido repite el producto y no deja comparar
 * de un vistazo contra la caja real.
 *
 * Se agrupa por `productoId`, como el inventario del camion de la web: dos
 * productos que se llaman igual con distinta unidad no son el mismo. Por la
 * misma razon no hay total general: kilos mas piezas no significa nada.
 */
export function conteoPorProducto(renglones: RenglonConProducto[]): ConteoDeProducto[] {
  const porProducto = new Map<string, ConteoDeProducto>();
  for (const renglon of renglones) {
    const actual = porProducto.get(renglon.productoId) ?? {
      productoId: renglon.productoId,
      nombre: renglon.nombre,
      unidad: renglon.unidad,
      cargado: 0,
      entregado: 0,
      devolucion: 0,
    };
    actual.cargado += renglon.cantidadCargada;
    actual.entregado += renglon.cantidadEntregada;
    actual.devolucion = actual.cargado - actual.entregado;
    porProducto.set(renglon.productoId, actual);
  }
  return [...porProducto.values()].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }),
  );
}

export interface ProductoDeLaLinea {
  nombre: string;
  unidad: string;
  cantidad: number;
}

/**
 * Lo que se escribe en la linea de productos de un pedido del corte.
 *
 * En una entrega, lo que el cliente **acepto**: de dos pollos de los que se
 * quedo uno, dice uno, y el renglon aceptado en cero desaparece. En una
 * devolucion todo lo aceptado es cero; lo que se cuenta es lo que vuelve a
 * bodega, o sea lo cargado. Sin esa excepcion la devolucion saldria vacia.
 */
export function productosDeLaLinea(
  devolucion: boolean,
  renglones: RenglonConProducto[],
): ProductoDeLaLinea[] {
  return renglones
    .map((r) => ({
      nombre: r.nombre,
      unidad: r.unidad,
      cantidad: devolucion ? r.cantidadCargada : r.cantidadEntregada,
    }))
    .filter((p) => p.cantidad > 0);
}

// ------------------------------------------------------------------
// Historial
// ------------------------------------------------------------------

/** Como acabo un pedido en una entrega concreta, que no es su estado de hoy. */
export enum ResultadoDelIntento {
  ENTREGADO = 'ENTREGADO',
  PARCIAL = 'PARCIAL',
  /** Sigue arriba del camion sin salir. */
  EN_CAMION = 'EN_CAMION',
  EN_RUTA = 'EN_RUTA',
  /** Volvio a bodega en el corte: puede haber salido despues en otra entrega. */
  DEVUELTO = 'DEVUELTO',
  CANCELADO = 'CANCELADO',
}

/** Un renglon del camion tal como lo lee el historial. */
export interface RenglonDelIntento {
  cantidadCargada: number;
  cantidadEntregada: number;
  motivoDevolucion: MotivoDevolucion | null;
  /** Null mientras sigue en el camion. */
  cerradoEn: Date | null;
}

export interface IntentoDeEntrega {
  resultado: ResultadoDelIntento;
  renglones: {
    cantidad: number;
    /** `null` mientras el pedido no cierra: no es cero, es que no se sabe. */
    recibido: number | null;
    motivo: MotivoDevolucion | null;
  }[];
}

/**
 * Lo que paso con un pedido en una entrega.
 *
 * El pedido de hoy puede estar en otra entrega o ya entregado por otro viaje,
 * asi que "se entrego aqui" es que siga atado a esta entrega y ENTREGADO: el
 * corte suelta la entrega de todo lo que regresa.
 */
export function intentoDeEntrega(
  pedido: PedidoClasificable & { entregaRutaId: string | null },
  entregaId: string,
  renglones: RenglonDelIntento[],
): IntentoDeEntrega {
  const entregadoAqui =
    pedido.entregaRutaId === entregaId && pedido.estado === EstadoPedido.ENTREGADO;
  const enCamion = renglones.some((r) => r.cerradoEn === null);

  let resultado: ResultadoDelIntento;
  if (pedido.estadoPago === EstadoPago.CANCELADO) resultado = ResultadoDelIntento.CANCELADO;
  else if (entregadoAqui) {
    const parcial = renglones.some((r) => r.cantidadEntregada < r.cantidadCargada);
    resultado = parcial ? ResultadoDelIntento.PARCIAL : ResultadoDelIntento.ENTREGADO;
  } else if (enCamion) {
    resultado =
      pedido.estado === EstadoPedido.EN_RUTA
        ? ResultadoDelIntento.EN_RUTA
        : ResultadoDelIntento.EN_CAMION;
  } else resultado = ResultadoDelIntento.DEVUELTO;

  return {
    resultado,
    renglones: renglones.map((r) => ({
      cantidad: r.cantidadCargada,
      recibido: entregadoAqui || r.cerradoEn !== null ? r.cantidadEntregada : null,
      motivo: r.motivoDevolucion,
    })),
  };
}

/**
 * Las cuentas del encabezado de una entrega ya cortada, leidas de como acabo
 * cada pedido en ella: despues del corte los que regresaron ya no apuntan a la
 * entrega y `indicadoresDeRuta` no los veria. Parcial cuenta como entregado,
 * igual que antes del corte; lo que siga en el camion (no deberia, tras cortar)
 * cuenta como devolucion, como en `esDevolucion`.
 */
export function indicadoresDelHistorial(resultados: ResultadoDelIntento[]): IndicadoresDeRuta {
  const entregado = (r: ResultadoDelIntento) =>
    r === ResultadoDelIntento.ENTREGADO || r === ResultadoDelIntento.PARCIAL;
  return {
    pedidos: resultados.length,
    entregados: resultados.filter(entregado).length,
    devoluciones: resultados.filter((r) => !entregado(r)).length,
  };
}

// ------------------------------------------------------------------
// Dinero despues del corte
// ------------------------------------------------------------------

/**
 * Por debajo de medio centavo no hay faltante. Los montos son Decimal y no
 * dejan colas, pero las pantallas los reciben como numero: sin esto un
 * redondeo de ellas pintaria un faltante fantasma.
 */
export const TOLERANCIA = new Decimal('0.005');

/**
 * Lo que falta por entregar de un corte.
 *
 * Se mide contra lo que Finanzas **conto**, no contra lo declarado: falta el
 * dinero que nunca llego a la caja, no el que el repartidor dijo que traia.
 * Sin contar todavia no hay contra que medir, y entregar de mas no deja saldo
 * negativo.
 */
export function saldoDelCorte(
  calculado: Decimal,
  recibido: Decimal | null,
  abonado: Decimal,
): Decimal {
  if (recibido === null) return new Decimal(0);
  const saldo = calculado.sub(recibido).sub(abonado);
  return saldo.lte(TOLERANCIA) ? new Decimal(0) : saldo;
}
