import { BadRequestException, PipeTransform } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';

/**
 * Filtro por tienda de Operaciones y Finanzas (`?tienda=`).
 *
 * Sirve para encontrar el pedido que tiene apartado el inventario de una
 * tienda. Un pedido es de una tienda por dos caminos: el de la app que se
 * recoge alli lleva `tiendaId`, y el de mostrador no lo lleva y su tienda es la
 * del turno en que se capturo. Por eso el filtro mira los dos.
 *
 * `bodega` son los que no pasaron por ninguna tienda: a domicilio y los que
 * nacen de un faltante de ruta.
 */
export const TIENDA_BODEGA = 'bodega';

export function dondeTienda(tienda: string | undefined): Prisma.PedidoWhereInput {
  if (!tienda) return {};
  if (tienda === TIENDA_BODEGA) return { tiendaId: null, turnoId: null };
  return { OR: [{ tiendaId: tienda }, { turno: { tiendaId: tienda } }] };
}

/** Deja pasar vacio, `bodega` o el id de una tienda; lo demas es 400. */
export class ParseFiltroTiendaPipe implements PipeTransform<unknown, string | undefined> {
  transform(valor: unknown): string | undefined {
    if (valor === undefined || valor === '') return undefined;
    if (valor === TIENDA_BODEGA || (typeof valor === 'string' && isUUID(valor))) {
      return valor as string;
    }
    throw new BadRequestException(`"tienda" debe ser "${TIENDA_BODEGA}" o el id de una tienda.`);
  }
}
