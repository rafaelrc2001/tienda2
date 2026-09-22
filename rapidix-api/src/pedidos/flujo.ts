import { EstadoPago, EstadoPedido, MetodoEntrega } from '@prisma/client';
import { Seccion } from '../auth/permisos';

/**
 * Reglas del avance fisico de un pedido. Funciones puras, sin base de datos:
 * las usa `FlujoPedidosService` para decidir y las pantallas (via la API) para
 * saber que boton encender. Un solo sitio, para que el boton y el candado no
 * puedan discrepar.
 */

/** Nombre legible de cada estado, para los mensajes de error. */
export const NOMBRE_ESTADO_PEDIDO: Readonly<Record<EstadoPedido, string>> = {
  CONFIRMADO: 'Confirmado',
  EN_PREPARACION: 'En preparación',
  PREPARADO: 'Preparado',
  LISTO_PARA_ENTREGA: 'Listo para entrega',
  RECOLECTADO: 'Recolectado',
  EN_RUTA: 'En ruta',
  ENTREGADO: 'Entregado',
};

export interface Transicion {
  de: EstadoPedido;
  a: EstadoPedido;
  /** Seccion del panel a la que le toca dar el paso. */
  seccion: Seccion;
  /** Solo para este modo de entrega; sin el, vale para los dos. */
  entrega?: MetodoEntrega;
  /** Si Finanzas tiene que haber liberado el pago antes. */
  exigeLiberado: boolean;
}

/**
 * Los unicos pasos que existen: siempre uno hacia adelante.
 *
 * Preparar no exige pago liberado: se puede ir surtiendo mientras Finanzas
 * decide. Desde "Listo para entrega" si, porque a partir de ahi la mercancia
 * ya puede salir. Recoger en tienda se entrega en mostrador desde Operaciones;
 * a domicilio pasa por Rutas.
 */
export const TRANSICIONES: readonly Transicion[] = [
  {
    de: EstadoPedido.CONFIRMADO,
    a: EstadoPedido.EN_PREPARACION,
    seccion: 'operaciones',
    exigeLiberado: false,
  },
  {
    de: EstadoPedido.EN_PREPARACION,
    a: EstadoPedido.PREPARADO,
    seccion: 'operaciones',
    exigeLiberado: false,
  },
  {
    de: EstadoPedido.PREPARADO,
    a: EstadoPedido.LISTO_PARA_ENTREGA,
    seccion: 'operaciones',
    exigeLiberado: true,
  },
  {
    de: EstadoPedido.LISTO_PARA_ENTREGA,
    a: EstadoPedido.ENTREGADO,
    seccion: 'operaciones',
    entrega: MetodoEntrega.TIENDA,
    exigeLiberado: true,
  },
  {
    de: EstadoPedido.LISTO_PARA_ENTREGA,
    a: EstadoPedido.RECOLECTADO,
    seccion: 'rutas',
    entrega: MetodoEntrega.DOMICILIO,
    exigeLiberado: true,
  },
  {
    de: EstadoPedido.RECOLECTADO,
    a: EstadoPedido.EN_RUTA,
    seccion: 'rutas',
    entrega: MetodoEntrega.DOMICILIO,
    exigeLiberado: true,
  },
  {
    de: EstadoPedido.EN_RUTA,
    a: EstadoPedido.ENTREGADO,
    seccion: 'rutas',
    entrega: MetodoEntrega.DOMICILIO,
    exigeLiberado: true,
  },
];

/**
 * "Liberado" no es un estado de pago sino una condicion: todo lo que no es
 * PAGO_PENDIENTE ni RETENER deja entregar. CANCELADO cuenta como liberado a
 * proposito; lo frena su propio candado, que se evalua antes.
 */
export function esLiberado(estadoPago: EstadoPago): boolean {
  return estadoPago !== EstadoPago.PAGO_PENDIENTE && estadoPago !== EstadoPago.RETENER;
}

export type CodigoBloqueo =
  | 'TRANSICION_INVALIDA'
  | 'SOLO_A_DOMICILIO'
  | 'SOLO_EN_TIENDA'
  | 'PEDIDO_CANCELADO'
  | 'PAGO_RETENIDO'
  | 'PAGO_NO_LIBERADO';

export interface Bloqueo {
  codigo: CodigoBloqueo;
  mensaje: string;
}

/** Lo minimo de un pedido que hace falta para decidir. */
export interface PedidoEnFlujo {
  estado: EstadoPedido;
  estadoPago: EstadoPago;
  metodoEntrega: MetodoEntrega;
}

/**
 * Decide si el pedido puede pasar a `destino`.
 *
 * El orden de las comprobaciones es el del mensaje que mas le sirve a quien
 * pulso: primero si el paso existe, luego si corresponde a su modo de entrega,
 * y al final lo que dice Finanzas (cancelado, retenido, sin liberar).
 */
export function evaluarAvance(
  pedido: PedidoEnFlujo,
  destino: EstadoPedido,
): { transicion: Transicion } | { bloqueo: Bloqueo } {
  const candidatas = TRANSICIONES.filter((t) => t.de === pedido.estado && t.a === destino);
  if (candidatas.length === 0) {
    return {
      bloqueo: {
        codigo: 'TRANSICION_INVALIDA',
        mensaje: `No se puede pasar de "${NOMBRE_ESTADO_PEDIDO[pedido.estado]}" a "${NOMBRE_ESTADO_PEDIDO[destino]}".`,
      },
    };
  }

  const transicion = candidatas.find((t) => !t.entrega || t.entrega === pedido.metodoEntrega);
  if (!transicion) {
    return {
      bloqueo:
        pedido.metodoEntrega === MetodoEntrega.TIENDA
          ? {
              codigo: 'SOLO_A_DOMICILIO',
              mensaje:
                'Los pedidos que se recogen en tienda no salen a ruta: se marcan "Entregado" directo.',
            }
          : {
              codigo: 'SOLO_EN_TIENDA',
              mensaje:
                'Los pedidos a domicilio deben pasar por Rutas ("Recolectado" y "En ruta") antes de "Entregado".',
            },
    };
  }

  if (pedido.estadoPago === EstadoPago.CANCELADO) {
    return {
      bloqueo: {
        codigo: 'PEDIDO_CANCELADO',
        mensaje: 'El pedido está cancelado y ya no puede avanzar.',
      },
    };
  }
  if (pedido.estadoPago === EstadoPago.RETENER) {
    return {
      bloqueo: {
        codigo: 'PAGO_RETENIDO',
        mensaje: 'Finanzas retuvo el pedido: debe liberarlo antes de avanzar.',
      },
    };
  }
  if (transicion.exigeLiberado && !esLiberado(pedido.estadoPago)) {
    return {
      bloqueo: {
        codigo: 'PAGO_NO_LIBERADO',
        mensaje: `Finanzas debe liberar el pago antes de marcarlo "${NOMBRE_ESTADO_PEDIDO[destino]}".`,
      },
    };
  }

  return { transicion };
}

/** Lo que la pantalla necesita para pintar el boton del siguiente paso. */
export interface PasoPendiente {
  /** `null`: ya no le queda ningun paso (entregado). */
  siguiente: EstadoPedido | null;
  /** A quien le toca darlo. */
  seccion: Seccion | null;
  /** Por que no se puede dar todavia; `null` si ya se puede. */
  bloqueo: Bloqueo | null;
}

/**
 * El siguiente paso y, si no se puede dar, por que. Lo calcula la API para que
 * la interfaz no lleve copia de las reglas: solo enciende o apaga el boton y
 * ensena el mensaje.
 */
export function pasoPendiente(pedido: PedidoEnFlujo): PasoPendiente {
  const transicion = siguientePaso(pedido);
  if (!transicion) return { siguiente: null, seccion: null, bloqueo: null };
  const resultado = evaluarAvance(pedido, transicion.a);
  return {
    siguiente: transicion.a,
    seccion: transicion.seccion,
    bloqueo: 'bloqueo' in resultado ? resultado.bloqueo : null,
  };
}

/**
 * El paso que le toca al pedido, sea quien sea el que lo da, o `null` si ya
 * no tiene ninguno (entregado). No mira el pago: para saber si se puede dar
 * ya, `evaluarAvance`.
 */
export function siguientePaso(pedido: PedidoEnFlujo): Transicion | null {
  return (
    TRANSICIONES.find(
      (t) => t.de === pedido.estado && (!t.entrega || t.entrega === pedido.metodoEntrega),
    ) ?? null
  );
}
