import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoPago, EstadoPedido, MetodoEntrega, Prisma, Tienda } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LineaAMover } from '../inventario/salidas-del-pedido';
import { GuardarTiendaDto } from './dto/tienda.dto';

/** Una fila del inventario de una tienda. */
export interface ExistenciaTiendaDto {
  productoId: string;
  nombre: string;
  categoria: string;
  unidad: string;
  cantidad: number;
}

/** Un producto del que la tienda no tiene lo que se le pide. */
export interface FaltanteEnTienda {
  productoId: string;
  nombre: string;
  pedido: number;
  /** Lo que queda libre: lo que hay menos lo ya prometido en pedidos sin entregar. */
  disponible: number;
}

/**
 * Las tiendas y lo que hay en cada una.
 *
 * El inventario de una tienda es al punto de venta lo que el camion es a la
 * ruta: sube cuando la tienda acepta una transferencia y baja cuando entrega
 * un pedido. Como los saldos de bodega, nadie lo pisa: se suma o se resta.
 */
@Injectable()
export class TiendasService {
  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------------
  // Catalogo de tiendas
  // ----------------------------------------------------------------

  /** Todas, tambien las apagadas: es la lista de Configuracion. */
  listar(): Promise<Tienda[]> {
    return this.prisma.tienda.findMany({ orderBy: { nombre: 'asc' } });
  }

  /** Las que se pueden elegir como destino o abrir en el punto de venta. */
  activas(): Promise<Tienda[]> {
    return this.prisma.tienda.findMany({ where: { activa: true }, orderBy: { nombre: 'asc' } });
  }

  async crear(dto: GuardarTiendaDto): Promise<Tienda> {
    await this.exigirNombreLibre(dto.nombre);
    return this.prisma.tienda.create({ data: TiendasService.datos(dto) });
  }

  async actualizar(id: string, dto: GuardarTiendaDto): Promise<Tienda> {
    await this.exigir(id);
    await this.exigirNombreLibre(dto.nombre, id);
    return this.prisma.tienda.update({ where: { id }, data: TiendasService.datos(dto) });
  }

  async exigir(id: string): Promise<Tienda> {
    const tienda = await this.prisma.tienda.findUnique({ where: { id } });
    if (!tienda) throw new NotFoundException('Tienda no encontrada');
    return tienda;
  }

  // ----------------------------------------------------------------
  // Inventario de la tienda
  // ----------------------------------------------------------------

  /**
   * Lo que hay en la tienda. Salen tambien los productos que se quedaron en
   * cero: que algo se acabo es justo lo que la tienda necesita ver.
   */
  async inventario(tiendaId: string): Promise<ExistenciaTiendaDto[]> {
    await this.exigir(tiendaId);
    const existencias = await this.prisma.inventarioTienda.findMany({
      where: { tiendaId, producto: { eliminadoEn: null } },
      include: { producto: { include: { categoria: { select: { nombre: true } } } } },
      orderBy: [{ producto: { categoria: { nombre: 'asc' } } }, { producto: { nombre: 'asc' } }],
    });
    return existencias.map((e) => ({
      productoId: e.productoId,
      nombre: e.producto.nombre,
      categoria: e.producto.categoria.nombre,
      unidad: e.producto.unidad,
      cantidad: e.cantidad,
    }));
  }

  /** Suma al inventario de la tienda lo que acaba de aceptar. */
  async entrar(
    tx: Prisma.TransactionClient,
    tiendaId: string,
    lineas: LineaAMover[],
  ): Promise<void> {
    for (const linea of lineas) {
      await tx.inventarioTienda.upsert({
        where: { tiendaId_productoId: { tiendaId, productoId: linea.productoId } },
        create: { tiendaId, productoId: linea.productoId, cantidad: linea.cantidad },
        update: { cantidad: { increment: linea.cantidad } },
      });
    }
  }

  /**
   * Resta del inventario de la tienda lo que se entrega a un cliente.
   *
   * Lo llama el punto de venta dentro de la transaccion que da por entregado
   * un pedido en mostrador. La condicion de saldo viaja en el `WHERE` del
   * propio `UPDATE`, igual que en bodega, asi que dos entregas simultaneas no
   * pueden dejar el saldo en negativo.
   *
   * `estricto` es el interruptor `controlInventario`: encendido, no se entrega
   * lo que la tienda no tiene. Apagado se resta hasta donde haya y la venta
   * sigue, por lo mismo que en bodega: nadie deja de vender por un saldo que
   * todavia no se ha capturado.
   */
  async salir(
    tx: Prisma.TransactionClient,
    tiendaId: string,
    lineas: LineaAMover[],
    estricto: boolean,
  ): Promise<void> {
    for (const linea of lineas) {
      if (linea.cantidad <= 0) continue;
      if (!estricto) {
        await tx.$executeRaw`
          UPDATE inventario_tienda
          SET cantidad = GREATEST(cantidad - ${linea.cantidad}, 0), "actualizadoEn" = now()
          WHERE "tiendaId" = ${tiendaId} AND "productoId" = ${linea.productoId}
        `;
        continue;
      }
      const { count } = await tx.inventarioTienda.updateMany({
        where: { tiendaId, productoId: linea.productoId, cantidad: { gte: linea.cantidad } },
        data: { cantidad: { decrement: linea.cantidad } },
      });
      if (count === 0) {
        const producto = await tx.producto.findUnique({
          where: { id: linea.productoId },
          select: { nombre: true },
        });
        throw new ConflictException({
          statusCode: 409,
          code: 'SIN_EXISTENCIA_EN_TIENDA',
          message: `La tienda no tiene ${linea.cantidad} de ${producto?.nombre ?? 'ese producto'}.`,
        });
      }
    }
  }

  /**
   * Lo que la tienda puede vender de cada producto: `productoId` -> piezas.
   * El que no aparece esta en cero. Sin `ids`, todos los que tiene.
   *
   * No mira `controlInventario`: lo que hay en la tienda entro por
   * transferencias aceptadas, asi que es un saldo capturado y no el cero con
   * el que nace la bodega.
   *
   * El saldo baja hasta la entrega, asi que a lo que hay se le quita lo que
   * ya esta prometido en pedidos de mostrador sin entregar: si no, dos
   * pedidos confirmarian la misma pieza y el segundo chocaria al entregarse.
   */
  async disponibles(tiendaId: string, ids?: string[]): Promise<Map<string, number>> {
    const deEsos = ids && { productoId: { in: ids } };
    const [existencias, prometidas] = await Promise.all([
      this.prisma.inventarioTienda.findMany({
        where: { tiendaId, ...deEsos },
        select: { productoId: true, cantidad: true },
      }),
      this.prisma.pedidoItem.groupBy({
        by: ['productoId'],
        where: {
          ...deEsos,
          pedido: {
            turno: { tiendaId },
            metodoEntrega: MetodoEntrega.TIENDA,
            estado: { not: EstadoPedido.ENTREGADO },
            estadoPago: { not: EstadoPago.CANCELADO },
          },
        },
        _sum: { cantidad: true },
      }),
    ]);

    const prometido = new Map(prometidas.map((p) => [p.productoId, p._sum.cantidad ?? 0]));
    return new Map(
      existencias.map((e) => [
        e.productoId,
        Math.max(e.cantidad - (prometido.get(e.productoId) ?? 0), 0),
      ]),
    );
  }

  /**
   * Lo que la tienda no alcanza a surtir de esas lineas. Vacio es que hay de
   * todo.
   *
   * Lo llama el punto de venta antes de confirmar un pedido: no se captura lo
   * que no esta en el anaquel.
   */
  async faltantes(tiendaId: string, lineas: LineaAMover[]): Promise<FaltanteEnTienda[]> {
    const pedidas = new Map<string, number>();
    for (const l of lineas) {
      if (l.cantidad <= 0) continue;
      pedidas.set(l.productoId, (pedidas.get(l.productoId) ?? 0) + l.cantidad);
    }
    const ids = [...pedidas.keys()];
    if (ids.length === 0) return [];

    const [disponibles, productos] = await Promise.all([
      this.disponibles(tiendaId, ids),
      this.prisma.producto.findMany({
        where: { id: { in: ids } },
        select: { id: true, nombre: true },
      }),
    ]);
    const nombres = new Map(productos.map((p) => [p.id, p.nombre]));

    const faltantes: FaltanteEnTienda[] = [];
    for (const [productoId, pedido] of pedidas) {
      const disponible = disponibles.get(productoId) ?? 0;
      if (pedido > disponible) {
        faltantes.push({
          productoId,
          nombre: nombres.get(productoId) ?? 'Ese producto',
          pedido,
          disponible,
        });
      }
    }
    return faltantes;
  }

  /** El faltante dicho como se lo lee el cajero. */
  static mensajeDeFaltante(f: FaltanteEnTienda): string {
    return f.disponible === 0
      ? `${f.nombre}: la tienda no tiene existencias.`
      : `${f.nombre}: pides ${f.pedido} y la tienda solo tiene ${f.disponible}.`;
  }

  // ----------------------------------------------------------------

  private async exigirNombreLibre(nombre: string, salvoId?: string): Promise<void> {
    const otra = await this.prisma.tienda.findFirst({
      where: {
        nombre: { equals: nombre.trim(), mode: 'insensitive' },
        ...(salvoId && { id: { not: salvoId } }),
      },
      select: { id: true },
    });
    if (otra) throw new ConflictException('Ya existe una tienda con ese nombre.');
  }

  private static datos(dto: GuardarTiendaDto) {
    return {
      nombre: dto.nombre.trim(),
      direccion: dto.direccion.trim(),
      responsable: dto.responsable.trim(),
      ...(dto.activa !== undefined && { activa: dto.activa }),
    };
  }
}
