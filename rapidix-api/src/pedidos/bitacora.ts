import { ActorBitacora, EjeBitacora, Prisma } from '@prisma/client';
import { ROL_CLIENTE, UsuarioAutenticado } from '../auth/jwt-payload';

/** Quien firma un renglon de la bitacora. */
export interface ActorDeBitacora {
  actor: ActorBitacora;
  actorId: string | null;
  actorNombre: string;
}

/** El sistema, para lo que no hace una persona (p. ej. un pago automatico). */
export const ACTOR_SISTEMA: ActorDeBitacora = {
  actor: ActorBitacora.SISTEMA,
  actorId: null,
  actorNombre: 'Rapidix',
};

/** El actor que corresponde a un token: cliente o personal. */
export function actorDe(usuario: UsuarioAutenticado): ActorDeBitacora {
  return {
    actor: usuario.rol === ROL_CLIENTE ? ActorBitacora.CLIENTE : ActorBitacora.PERSONAL,
    actorId: usuario.sub,
    actorNombre: usuario.nombre,
  };
}

/**
 * Escribe un renglon de la bitacora del pedido.
 *
 * Siempre dentro de la transaccion que cambia el estado: si el cambio no se
 * guarda, tampoco queda el renglon, y al reves.
 */
export async function registrarEnBitacora(
  tx: Prisma.TransactionClient,
  pedidoId: string,
  cambio: {
    eje: EjeBitacora;
    estadoAnterior: string | null;
    estadoNuevo: string;
    nota?: string | null;
  },
  quien: ActorDeBitacora,
): Promise<void> {
  await tx.bitacoraPedido.create({
    data: {
      pedidoId,
      eje: cambio.eje,
      estadoAnterior: cambio.estadoAnterior,
      estadoNuevo: cambio.estadoNuevo,
      nota: cambio.nota?.trim() || null,
      ...quien,
    },
  });
}
