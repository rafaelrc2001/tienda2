import { EstadoPedido, Prisma } from '@prisma/client';
import {
  CargaLiquidable,
  devueltoDelRenglon,
  efectivoDelPedido,
  PedidoALiquidar,
} from './dinero-del-corte';

const Decimal = Prisma.Decimal;

/**
 * Que abarca el corte de una entrega y que le pasa a cada cosa del camion.
 *
 * Funciones puras, sin base de datos: `CortesService` lee las filas, pregunta
 * aqui y escribe. Separado para probarlo, porque un error aqui no se ve en
 * pantalla sino en el dinero que se pide y en la mercancia que vuelve.
 */

/** Lo que el servicio sabe de la entrega antes de cortarla. */
export interface EntregaACortar {
  entregaId: string;
  sesionId: string;
  finalizadaEn: Date | null;
  /** Las demas entregas de la jornada que aun no tienen corte. */
  otrasVivas: number;
}

/**
 * Lo que abarca el corte de una entrega. La ultima entrega sin liquidar se
 * lleva ademas lo que no tiene entrega (pedidos cargados antes de que
 * existieran), para que nada se quede sin cobrar.
 *
 * Es el alcance del **dinero**. La mercancia no baja al liquidar sino cuando
 * Finanzas acepta la devolucion, y su alcance es `alcanceDeLaDescarga()`.
 */
export interface AlcanceDelCorte {
  sesionId: string;
  finalizadaEn: Date | null;
  /** Es la ultima entrega de la jornada que faltaba por liquidar. */
  cierraJornada: boolean;
  pedidos: Prisma.PedidoWhereInput;
}

export function alcanceDelCorte(entrega: EntregaACortar): AlcanceDelCorte {
  const cierraJornada = entrega.otrasVivas === 0;
  return {
    sesionId: entrega.sesionId,
    finalizadaEn: entrega.finalizadaEn,
    cierraJornada,
    pedidos: cierraJornada
      ? { OR: [{ entregaRutaId: entrega.entregaId }, { entregaRutaId: null }] }
      : { entregaRutaId: entrega.entregaId },
  };
}

/** Lo que el servicio sabe de la entrega al aceptar su devolucion. */
export interface EntregaADescargar {
  entregaId: string;
  sesionId: string;
  /**
   * Las demas entregas de la jornada que siguen vivas para ella: las que no se
   * han liquidado y las liquidadas cuya devolucion aun no se acepta. Mientras
   * quede una, su mercancia sigue arriba y la jornada no puede cerrarse.
   */
  otrasVivas: number;
}

export interface AlcanceDeLaDescarga {
  /** Con esta devolucion el camion queda vacio: la jornada se cierra. */
  cierraJornada: boolean;
  cargas: Prisma.CargaRepartidorWhereInput;
}

/**
 * Los renglones del camion que baja "Aceptar devolucion": los de los pedidos
 * de esa entrega, entregados o no. Un pedido entregado conserva su entrega, y
 * uno que no se entrego la conserva tambien hasta que esta descarga lo
 * devuelve a la cola.
 *
 * La que cierra la jornada se lleva ademas lo que no tiene entrega, por lo
 * mismo que el corte: que nada quede en el camion.
 */
export function alcanceDeLaDescarga(entrega: EntregaADescargar): AlcanceDeLaDescarga {
  const cierraJornada = entrega.otrasVivas === 0;
  return {
    cierraJornada,
    cargas: {
      sesionId: entrega.sesionId,
      cerradoEn: null,
      pedido: cierraJornada
        ? { OR: [{ entregaRutaId: entrega.entregaId }, { entregaRutaId: null }] }
        : { entregaRutaId: entrega.entregaId },
    },
  };
}

// ------------------------------------------------------------------
// El dinero y las piezas
// ------------------------------------------------------------------

/** Un pedido del alcance, con sus renglones abiertos del camion. */
export interface PedidoDelAlcance extends PedidoALiquidar {
  id: string;
  estado: EstadoPedido;
  cargas: CargaLiquidable[];
}

export interface CuentaDelCorte {
  montoCalculado: Prisma.Decimal;
  /** Por pedido, en el mismo orden en que llegaron. */
  porPedido: { id: string; efectivo: Prisma.Decimal; devueltas: number }[];
  piezasQueRegresan: number;
  /** Pedidos que no se entregaron y vuelven a la cola. */
  pedidosQueRegresan: number;
}

/**
 * Suma lo que el repartidor trae y cuenta lo que regresa.
 *
 * Solo el dinero de lo que se entrego: un pedido que vuelve entero no cobra
 * nada, aunque sea en efectivo y este pendiente de pago.
 */
export function cuentaDelCorte(pedidos: PedidoDelAlcance[]): CuentaDelCorte {
  let total = new Decimal(0);
  let piezas = 0;
  let regresan = 0;

  const porPedido = pedidos.map((pedido) => {
    const entregado = pedido.estado === EstadoPedido.ENTREGADO;
    // El pedido entregado ya vale lo que el cliente se quedo: su total manda.
    const efectivo = entregado ? efectivoDelPedido(pedido) : new Decimal(0);
    const devueltas = pedido.cargas.reduce((suma, c) => suma + devueltoDelRenglon(c), 0);

    total = total.add(efectivo);
    piezas += devueltas;
    if (!entregado) regresan++;
    return { id: pedido.id, efectivo, devueltas };
  });

  return {
    montoCalculado: total,
    porPedido,
    piezasQueRegresan: piezas,
    pedidosQueRegresan: regresan,
  };
}

// ------------------------------------------------------------------
// La descarga
// ------------------------------------------------------------------

/** Un renglon abierto del camion, tal como lo lee la descarga. */
export interface RenglonADescargar {
  id: string;
  pedidoId: string;
  productoId: string;
  cantidadCargada: number;
  cantidadEntregada: number;
  pedido: { folio: string; estado: EstadoPedido };
}

export interface PedidoQueRegresa {
  pedidoId: string;
  folio: string;
  estado: EstadoPedido;
  /** Lo que baja del camion, por producto. */
  lineas: { productoId: string; cantidad: number }[];
  /**
   * Lo rechazado de un pedido entregado vuelve a estar disponible. El que no
   * se entrego sigue apartado para su cliente: soltarlo lo venderia a otro y,
   * si luego se cancelara, se devolveria dos veces.
   */
  liberaInventario: boolean;
  /** No se entrego: vuelve a "Listo para entrega" y suelta repartidor y entrega. */
  vuelveACola: boolean;
  /**
   * Lo que vuelve al estante, por producto: lo que baja del camion menos lo
   * cobrado como faltante. Aplica igual al rechazado que al pedido que regresa
   * entero —los dos salieron del fisico al recolectarse—; vacio con el control
   * de inventario apagado.
   */
  alFisico: { productoId: string; cantidad: number }[];
}

export interface PlanDeDescarga {
  /** Cada renglon se cierra con lo que devuelve, aunque sea cero. */
  cierres: { id: string; cantidadDevuelta: number }[];
  /** Solo los pedidos a los que les regresa algo. */
  pedidos: PedidoQueRegresa[];
}

/**
 * Que pasa con cada renglon del camion al cortar.
 *
 * Con el control de inventario apagado no se libera ni vuelve nada al fisico,
 * igual que en el checkout: devolver a una bodega que nadie ha capturado
 * inventaria existencia. El pedido que no se entrego vuelve a la cola igual.
 *
 * Son dos cuentas distintas. **Al fisico** (`alFisico`) vuelve todo lo que
 * baja del camion, sea de quien sea: salio del estante al recolectarse.
 * **Para venta** (`lineas` de los que liberan) solo lo que un cliente rechazo
 * de un pedido entregado; el que regresa entero sigue apartado.
 *
 * `faltantes` es lo que ya se cobro con "Generar pedido x faltante", por
 * producto: esas piezas no bajaron del camion, asi que ni vuelven al fisico ni
 * se liberan para venta. Se descuentan primero de lo rechazado en la puerta y
 * lo que sobre de los pedidos que vuelven a la cola, de modo que lo que vuelve
 * al fisico de cada producto es justo lo que se conto al bajar.
 */
export function planDeDescarga(
  renglones: RenglonADescargar[],
  controlInventario: boolean,
  faltantes: ReadonlyMap<string, number> = new Map(),
): PlanDeDescarga {
  const cierres: PlanDeDescarga['cierres'] = [];
  const porPedido = new Map<string, PedidoQueRegresa>();

  for (const renglon of renglones) {
    const devueltas = renglon.cantidadCargada - renglon.cantidadEntregada;
    cierres.push({ id: renglon.id, cantidadDevuelta: devueltas });
    if (devueltas <= 0) continue;

    const entregado = renglon.pedido.estado === EstadoPedido.ENTREGADO;
    const pedido = porPedido.get(renglon.pedidoId) ?? {
      pedidoId: renglon.pedidoId,
      folio: renglon.pedido.folio,
      estado: renglon.pedido.estado,
      lineas: [],
      liberaInventario: controlInventario && entregado,
      vuelveACola: !entregado,
      alFisico: [],
    };
    pedido.lineas.push({ productoId: renglon.productoId, cantidad: devueltas });
    porPedido.set(renglon.pedidoId, pedido);
  }

  // Los entregados primero: el faltante se gasta antes en lo rechazado, y solo
  // lo que sobre toca a los pedidos que regresan enteros.
  const pedidos = [...porPedido.values()];
  const enOrden = [
    ...pedidos.filter((p) => !p.vuelveACola),
    ...pedidos.filter((p) => p.vuelveACola),
  ];

  const porDescontar = new Map(faltantes);
  for (const pedido of enOrden) {
    const bajaron = pedido.lineas
      .map((linea) => {
        const pendiente = porDescontar.get(linea.productoId) ?? 0;
        const falta = Math.min(pendiente, linea.cantidad);
        porDescontar.set(linea.productoId, pendiente - falta);
        return { ...linea, cantidad: linea.cantidad - falta };
      })
      .filter((linea) => linea.cantidad > 0);

    if (controlInventario) pedido.alFisico = bajaron;
    // El que no libera conserva sus lineas enteras: son lo que su pedido lleva
    // de vuelta, no lo que se libera.
    if (pedido.liberaInventario) pedido.lineas = bajaron;
  }

  return { cierres, pedidos };
}
