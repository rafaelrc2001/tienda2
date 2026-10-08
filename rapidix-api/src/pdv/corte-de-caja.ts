import { EstadoPago, EstadoPedido, MetodoEntrega, MetodoPago, Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * Las cuentas del corte de caja de un turno. Funciones puras, sin base de
 * datos, para que el turno abierto y el corte ya cerrado digan lo mismo.
 */

/** Lo minimo de un pedido que hace falta para contarlo en caja. */
export interface PedidoDelTurno {
  estado: EstadoPedido;
  estadoPago: EstadoPago;
  metodoPago: MetodoPago;
  metodoEntrega: MetodoEntrega;
  total: Decimal;
  pagadoConBilletera: Decimal;
}

export interface TotalesDelTurno {
  /** Todos los que se capturaron en el turno, cancelados incluidos. */
  pedidos: number;
  /** Los que suman a la caja: ver `cobradoEnCaja`. */
  cobrados: number;
  /** Confirmados para llevar que nadie ha entregado: impiden cerrar el turno. */
  porEntregar: number;
  /** Se cobraron aqui pero los entrega Rutas. Ya van contados en `cobrados`. */
  aDomicilio: number;
  cancelados: number;
  /** Lo que valen los cobrados. */
  ventas: Decimal;
  efectivo: Decimal;
  transferencia: Decimal;
  billetera: Decimal;
}

/**
 * Si el dinero del pedido esta en esta caja.
 *
 * El punto de venta cobra de contado, asi que el que va a domicilio cuenta
 * desde que se confirma: el cajero ya recibio el dinero y Rutas solo lo
 * lleva (el repartidor no cobra un pedido pagado, asi que no se suma dos
 * veces). El que se lleva en mostrador cuenta al entregarse; mientras tanto
 * es un pendiente que impide el corte. El entregado a credito no cuenta:
 * nadie pago nada en caja.
 */
export function cobradoEnCaja(pedido: PedidoDelTurno): boolean {
  if (pedido.estadoPago !== EstadoPago.PAGADO) return false;
  return (
    pedido.metodoEntrega === MetodoEntrega.DOMICILIO || pedido.estado === EstadoPedido.ENTREGADO
  );
}

/** Para llevar, vivo y todavia en el mostrador. */
export function porEntregarEnCaja(pedido: PedidoDelTurno): boolean {
  return (
    pedido.metodoEntrega === MetodoEntrega.TIENDA &&
    pedido.estado !== EstadoPedido.ENTREGADO &&
    pedido.estadoPago !== EstadoPago.CANCELADO
  );
}

/** Lo minimo de un pedido para contar lo que salio de la tienda. */
export interface PedidoConProductos {
  estado: EstadoPedido;
  estadoPago: EstadoPago;
  metodoEntrega: MetodoEntrega;
  items: {
    productoId: string;
    nombre: string;
    unidad: string;
    cantidad: number;
    importe: Decimal | number;
  }[];
}

/** Un producto con todo lo que el turno entrego de el. */
export interface ProductoEntregado {
  productoId: string;
  nombre: string;
  unidad: string;
  cantidad: number;
  importe: Decimal;
}

/**
 * Lo que el turno entrego en el mostrador, sumado por producto y en orden
 * alfabetico: es lo que salio del inventario de la tienda.
 *
 * Cuenta tambien lo entregado a credito, que `cobradoEnCaja` deja fuera: no
 * dejo dinero en caja, pero la mercancia si salio. Lo que va a domicilio sale
 * de bodega y no aparece aqui.
 */
export function productosEntregados(pedidos: PedidoConProductos[]): ProductoEntregado[] {
  const porProducto = new Map<string, ProductoEntregado>();
  for (const pedido of pedidos) {
    if (
      pedido.metodoEntrega !== MetodoEntrega.TIENDA ||
      pedido.estado !== EstadoPedido.ENTREGADO ||
      pedido.estadoPago === EstadoPago.CANCELADO
    ) {
      continue;
    }
    for (const item of pedido.items) {
      const suma = porProducto.get(item.productoId) ?? {
        productoId: item.productoId,
        nombre: item.nombre,
        unidad: item.unidad,
        cantidad: 0,
        importe: new Decimal(0),
      };
      suma.cantidad += item.cantidad;
      suma.importe = suma.importe.add(item.importe);
      porProducto.set(item.productoId, suma);
    }
  }
  return [...porProducto.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export function totalesDelTurno(pedidos: PedidoDelTurno[]): TotalesDelTurno {
  const totales: TotalesDelTurno = {
    pedidos: pedidos.length,
    cobrados: 0,
    porEntregar: 0,
    aDomicilio: 0,
    cancelados: 0,
    ventas: new Decimal(0),
    efectivo: new Decimal(0),
    transferencia: new Decimal(0),
    billetera: new Decimal(0),
  };

  for (const pedido of pedidos) {
    if (pedido.estadoPago === EstadoPago.CANCELADO) {
      totales.cancelados++;
      continue;
    }
    // Se cuenta aparte y ademas sigue hacia abajo: su dinero tambien es de la caja.
    if (pedido.metodoEntrega === MetodoEntrega.DOMICILIO) totales.aDomicilio++;
    if (porEntregarEnCaja(pedido)) {
      totales.porEntregar++;
      continue;
    }
    if (!cobradoEnCaja(pedido)) continue;

    // La billetera no es un metodo: se combina con cualquiera de los dos, y lo
    // que queda es lo que entro por el metodo elegido.
    const cobrado = pedido.total.sub(pedido.pagadoConBilletera);
    totales.cobrados++;
    totales.ventas = totales.ventas.add(pedido.total);
    totales.billetera = totales.billetera.add(pedido.pagadoConBilletera);
    if (pedido.metodoPago === MetodoPago.EFECTIVO) {
      totales.efectivo = totales.efectivo.add(cobrado);
    } else {
      totales.transferencia = totales.transferencia.add(cobrado);
    }
  }
  return totales;
}
