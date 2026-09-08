import { Cliente, Prospecto } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Quien hay detras de un token de rol CLIENTE.
 *
 * El `sub` puede apuntar a `clientes` o a `prospectos`, y se resuelve mirando
 * la base, no el `tipo` que trae el token: al convertirse un prospecto el
 * cliente nuevo conserva su id, asi que un token emitido antes de la primera
 * compra sigue siendo valido pero se queda con el `tipo` viejo. Manda la base.
 */
export interface Identidad {
  /** Puesto si ya compro alguna vez. */
  cliente: Cliente | null;
  /** Puesto si se registro pero todavia no ha comprado. */
  prospecto: Prospecto | null;
}

/**
 * Busca el id en las dos tablas. Como mucho aparece en una: un prospecto deja
 * de existir en el momento en que se convierte.
 */
export async function resolverIdentidad(prisma: PrismaService, id: string): Promise<Identidad> {
  const cliente = await prisma.cliente.findUnique({ where: { id } });
  if (cliente) return { cliente, prospecto: null };
  return { cliente: null, prospecto: await prisma.prospecto.findUnique({ where: { id } }) };
}

/**
 * Si todavia no ha comprado.
 *
 * Es la comprobacion que hacen las secciones reservadas a clientes: guardar
 * recetas, el cashback y los pedidos no existen antes del primer pedido.
 */
export async function esProspectoEnBase(prisma: PrismaService, id: string): Promise<boolean> {
  return (await prisma.prospecto.count({ where: { id } })) > 0;
}
