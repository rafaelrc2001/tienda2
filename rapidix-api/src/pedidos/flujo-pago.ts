import { EstadoPago, EstadoPedido } from '@prisma/client';

/**
 * Reglas del eje del dinero. Funciones puras, sin base de datos: las usa
 * `FinanzasService` para decidir y la pantalla (via la API) para saber que
 * boton encender, igual que `flujo.ts` con el eje fisico.
 *
 * A diferencia del avance fisico, aqui **no hay secuencia**: Finanzas mueve el
 * pedido de cualquier estado a cualquier otro. Lo unico que existe es un
 * destino terminal (cancelado) y un candado sobre el (la mercancia que ya
 * salio de bodega).
 */

/** Nombre legible de cada estado, para los mensajes y para la interfaz. */
export const NOMBRE_ESTADO_PAGO: Readonly<Record<EstadoPago, string>> = {
  PAGO_PENDIENTE: 'Pago pendiente',
  RETENER: 'Retener',
  CREDITO: 'Crédito',
  REEMBOLSADO: 'Reembolsado',
  PAGADO: 'Pagado',
  CANCELADO: 'Cancelado',
};

/**
 * El orden en que Finanzas ve los botones. Es el del prototipo: primero lo que
 * frena o deja seguir, al final lo que cierra el pedido.
 *
 * No hay "Liberar": el pago pendiente deja avanzar por si solo (ver
 * `esLiberado` en `flujo.ts`) y pulsar un boton por cada pedido solo hacia
 * lento el proceso. La migracion `quitar_liberar` paso a PAGO_PENDIENTE los
 * pedidos que lo tenian.
 */
export const ESTADOS_PAGO: readonly EstadoPago[] = [
  EstadoPago.PAGO_PENDIENTE,
  EstadoPago.RETENER,
  EstadoPago.CREDITO,
  EstadoPago.REEMBOLSADO,
  EstadoPago.PAGADO,
  EstadoPago.CANCELADO,
];

/**
 * Estados fisicos en los que la mercancia ya no esta en bodega. Cancelar
 * despues de esto no es cancelar sino registrar una devolucion, y eso todavia
 * no existe: se prefiere frenar a dejar el inventario descuadrado.
 */
const FUERA_DE_BODEGA: readonly EstadoPedido[] = [
  EstadoPedido.RECOLECTADO,
  EstadoPedido.EN_RUTA,
  EstadoPedido.ENTREGADO,
];

export type CodigoBloqueoPago = 'PAGO_TERMINAL' | 'MERCANCIA_FUERA' | 'MISMO_ESTADO';

export interface BloqueoPago {
  codigo: CodigoBloqueoPago;
  mensaje: string;
}

/** Lo minimo de un pedido que hace falta para decidir. */
export interface PedidoEnPago {
  estado: EstadoPedido;
  estadoPago: EstadoPago;
}

/**
 * Que hay que hacer con un cambio de estatus de pago.
 *
 * `aclaracion` es el unico caso en que se acepta el estado que ya tiene:
 * re-cancelar con una nota para explicar mejor una cancelacion. No repite los
 * efectos —el inventario ya volvio—, solo deja el renglon en la bitacora.
 */
export type Resultado = { accion: 'cambiar' } | { accion: 'aclaracion' } | { bloqueo: BloqueoPago };

/**
 * Decide si Finanzas puede dejar el pedido en `destino`.
 *
 * `hayNota` solo importa para la aclaracion: cancelar dos veces sin explicar
 * nada no aporta un renglon que valga la pena.
 */
export function evaluarCambioPago(
  pedido: PedidoEnPago,
  destino: EstadoPago,
  hayNota = false,
): Resultado {
  // Cancelado es terminal: el inventario ya regreso y el saldo ya se devolvio.
  // Si el cliente retoma la compra se levanta un pedido nuevo.
  if (pedido.estadoPago === EstadoPago.CANCELADO) {
    if (destino === EstadoPago.CANCELADO && hayNota) return { accion: 'aclaracion' };
    return {
      bloqueo: {
        codigo: 'PAGO_TERMINAL',
        mensaje:
          'Un pedido cancelado ya no cambia de estatus: su inventario regresó a bodega. ' +
          'Si el cliente retoma la compra, levanta un pedido nuevo.',
      },
    };
  }

  if (destino === EstadoPago.CANCELADO && FUERA_DE_BODEGA.includes(pedido.estado)) {
    return {
      bloqueo: {
        codigo: 'MERCANCIA_FUERA',
        mensaje:
          `El pedido ya salió de bodega: no se puede cancelar. ` +
          'Regístralo como devolución cuando regrese la mercancía.',
      },
    };
  }

  if (destino === pedido.estadoPago) {
    return {
      bloqueo: {
        codigo: 'MISMO_ESTADO',
        mensaje: `El pedido ya está en "${NOMBRE_ESTADO_PAGO[destino]}".`,
      },
    };
  }

  return { accion: 'cambiar' };
}

/** Lo que la pantalla necesita para pintar cada uno de los siete botones. */
export interface BotonPago {
  estado: EstadoPago;
  titulo: string;
  /** Es el que tiene ahora: se pinta apagado pero no es un error. */
  actual: boolean;
  /** Por que no se puede pulsar; `null` si se puede. */
  bloqueo: BloqueoPago | null;
}

/**
 * Los botones con su candado resuelto. Lo calcula la API para que la interfaz
 * no lleve copia de las reglas, igual que `pasoPendiente()` en el eje fisico.
 */
export function botonesDePago(pedido: PedidoEnPago): BotonPago[] {
  return ESTADOS_PAGO.map((estado) => {
    const resultado = evaluarCambioPago(pedido, estado);
    const actual = estado === pedido.estadoPago;
    return {
      estado,
      titulo: NOMBRE_ESTADO_PAGO[estado],
      actual,
      // "Ya es el estatus actual" no es un candado que haya que explicar: el
      // boton se apaga porque no hay nada que hacer, no porque algo lo frene.
      bloqueo: actual || !('bloqueo' in resultado) ? null : resultado.bloqueo,
    };
  });
}
