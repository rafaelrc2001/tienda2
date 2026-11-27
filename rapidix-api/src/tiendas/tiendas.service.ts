import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EstadoPago,
  EstadoPedido,
  MetodoEntrega,
  Prisma,
  RolUsuario,
  Tienda,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { LineaAMover } from '../inventario/salidas-del-pedido';
import { GuardarTiendaDto } from './dto/tienda.dto';
import { HorarioSemanal, leerHorario } from '../configuracion/horario';

/**
 * Una fila del inventario de una tienda.
 *
 * `cantidad` es lo que hay en el anaquel y `disponible` lo que todavia se
 * puede prometer (ATP): la diferencia son pedidos confirmados sin entregar.
 * Van los tres numeros porque con solo la existencia el gerente veia piezas
 * de sobra, no resurtia, y la Tienda las ofrecia agotadas.
 */
export interface ExistenciaTiendaDto {
  productoId: string;
  nombre: string;
  categoria: string;
  unidad: string;
  cantidad: number;
  /** Piezas de pedidos sin entregar (mostrador y app por recoger) de esta tienda. */
  comprometido: number;
  /** Existencia menos comprometido, sin bajar de cero. Lo que se ofrece a la venta. */
  disponible: number;
  /**
   * Interruptor "Habilitar" de Productos. Apagado, el producto sale agotado en
   * todas las tiendas aunque haya disponible.
   */
  habilitado: boolean;
}

/** Un producto del que la tienda no tiene lo que se le pide. */
export interface FaltanteEnTienda {
  productoId: string;
  nombre: string;
  pedido: number;
  /** Lo que queda libre: lo que hay menos lo ya prometido en pedidos sin entregar. */
  disponible: number;
}

/** Lo que el cliente necesita de una tienda para elegir donde recoge. */
export interface TiendaParaRecogerDto {
  id: string;
  nombre: string;
  direccion: string;
  /** Para enseñarlo al elegir tienda. `null` si no se ha capturado. */
  horario: HorarioSemanal | null;
}

/**
 * Donde se recoge un pedido de la app. `tienda` en `null` y sin error es que
 * el negocio no tiene tiendas activas: el pedido lo surte bodega, como antes
 * de que hubiera tiendas.
 */
export interface RecogidaResuelta {
  tienda: Tienda | null;
  error: { codigo: 'TIENDA_REQUERIDA' | 'TIENDA_NO_DISPONIBLE'; mensaje: string } | null;
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

  /**
   * Las que el punto de venta le ofrece a quien entra. El cajero (PDV) con
   * tienda asignada solo tiene esa: abrir caja en otra seria cobrar en una
   * tienda que no es la suya. Si no tiene ninguna asignada ve todas, para que
   * una cuenta a medio configurar no se quede sin poder trabajar.
   */
  async activasPara(usuario: UsuarioAutenticado): Promise<Tienda[]> {
    if (usuario.rol === RolUsuario.PDV) {
      const ficha = await this.prisma.usuario.findUnique({
        where: { id: usuario.sub },
        select: { tiendaId: true },
      });
      if (ficha?.tiendaId) {
        return this.prisma.tienda.findMany({ where: { id: ficha.tiendaId, activa: true } });
      }
    }
    return this.activas();
  }

  /** Las tiendas entre las que el cliente elige al pedir «Recoger en tienda». */
  async paraRecoger(): Promise<TiendaParaRecogerDto[]> {
    const tiendas = await this.activas();
    return tiendas.map((t) => ({
      id: t.id,
      nombre: t.nombre,
      direccion: t.direccion,
      horario: leerHorario(t.horario),
    }));
  }

  /**
   * La tienda donde se recoge un pedido de la app, o por que no vale la que
   * mando el carrito. No lanza: la previsualizacion lo ensena como aviso y el
   * checkout lo convierte en su 409.
   *
   * Habiendo tiendas activas hay que elegir una: sin ella nadie sabria donde
   * preparar el pedido.
   */
  async resolverRecogida(tiendaId: string | undefined): Promise<RecogidaResuelta> {
    if (!tiendaId) {
      const hay = await this.prisma.tienda.count({ where: { activa: true } });
      return hay === 0
        ? { tienda: null, error: null }
        : {
            tienda: null,
            error: {
              codigo: 'TIENDA_REQUERIDA',
              mensaje: 'Elige en qué tienda recoges tu pedido.',
            },
          };
    }
    const tienda = await this.prisma.tienda.findUnique({ where: { id: tiendaId } });
    if (!tienda?.activa) {
      return {
        tienda: null,
        error: {
          codigo: 'TIENDA_NO_DISPONIBLE',
          mensaje: 'Esa tienda ya no está disponible para recoger: elige otra.',
        },
      };
    }
    return { tienda, error: null };
  }

  /**
   * La tienda, si existe y sigue activa. Una apagada no vende: quien la tenia
   * recordada en el navegador vuelve a ver la bodega hasta que elija otra.
   */
  async activa(id: string | undefined): Promise<Tienda | null> {
    if (!id) return null;
    const tienda = await this.prisma.tienda.findUnique({ where: { id } });
    return tienda?.activa ? tienda : null;
  }

  async crear(dto: GuardarTiendaDto): Promise<Tienda> {
    await this.exigirNombreLibre(dto.nombre);
    return this.prisma.tienda.create({ data: TiendasService.datos(dto) });
  }

  /**
   * No se apaga una tienda con pedidos de la app por recoger (409
   * `TIENDA_CON_PEDIDOS`): apagada ya no se abre en el punto de venta, y esos
   * pedidos tampoco salen en Operaciones, asi que nadie podria entregarlos.
   */
  async actualizar(id: string, dto: GuardarTiendaDto): Promise<Tienda> {
    const tienda = await this.exigir(id);
    await this.exigirNombreLibre(dto.nombre, id);
    if (tienda.activa && dto.activa === false) {
      const porRecoger = await this.prisma.pedido.count({
        where: {
          tiendaId: id,
          estado: { not: EstadoPedido.ENTREGADO },
          estadoPago: { not: EstadoPago.CANCELADO },
        },
      });
      if (porRecoger > 0) {
        throw new ConflictException({
          statusCode: 409,
          code: 'TIENDA_CON_PEDIDOS',
          message: `La tienda tiene ${porRecoger} pedido(s) por recoger: entrégalos o pide a Finanzas que los cancele antes de desactivarla.`,
        });
      }
    }
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
    const [existencias, prometido] = await Promise.all([
      this.prisma.inventarioTienda.findMany({
        where: { tiendaId, producto: { eliminadoEn: null } },
        include: { producto: { include: { categoria: { select: { nombre: true } } } } },
        orderBy: [{ producto: { categoria: { nombre: 'asc' } } }, { producto: { nombre: 'asc' } }],
      }),
      this.prometido(tiendaId),
    ]);
    return existencias.map((e) => {
      const comprometido = prometido.get(e.productoId) ?? 0;
      return {
        productoId: e.productoId,
        nombre: e.producto.nombre,
        categoria: e.producto.categoria.nombre,
        unidad: e.producto.unidad,
        cantidad: e.cantidad,
        comprometido,
        disponible: Math.max(e.cantidad - comprometido, 0),
        habilitado: !e.producto.agotado,
      };
    });
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
   * un pedido: el que se capturo en mostrador o el de la app que se recoge en
   * esa tienda. La condicion de saldo viaja en el `WHERE` del
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
   * Piezas prometidas en pedidos sin entregar de la tienda: `productoId` ->
   * piezas. Los de mostrador de sus turnos y los de la app que se recogen
   * aqui; un cancelado ya no aparta nada. Lo comparten `disponibles` (lo que
   * se vende) e `inventario` (lo que ve el gerente) para que no diverjan.
   */
  private async prometido(tiendaId: string, ids?: string[]): Promise<Map<string, number>> {
    const prometidas = await this.prisma.pedidoItem.groupBy({
      by: ['productoId'],
      where: {
        ...(ids && { productoId: { in: ids } }),
        pedido: {
          OR: [{ turno: { tiendaId } }, { tiendaId }],
          metodoEntrega: MetodoEntrega.TIENDA,
          estado: { not: EstadoPedido.ENTREGADO },
          estadoPago: { not: EstadoPago.CANCELADO },
        },
      },
      _sum: { cantidad: true },
    });
    return new Map(prometidas.map((p) => [p.productoId, p._sum.cantidad ?? 0]));
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
   * ya esta prometido en pedidos sin entregar —los de mostrador de sus turnos
   * y los de la app que se recogen aqui—: si no, dos pedidos confirmarian la
   * misma pieza y el segundo chocaria al entregarse.
   *
   * `liberadas` son las piezas de un pedido del mostrador que se esta
   * corrigiendo: al cancelarlo vuelven al anaquel —o dejan de estar
   * prometidas—, asi que el corregido puede volver a venderlas.
   */
  async disponibles(
    tiendaId: string,
    ids?: string[],
    liberadas: LineaAMover[] = [],
  ): Promise<Map<string, number>> {
    const [existencias, prometido] = await Promise.all([
      this.prisma.inventarioTienda.findMany({
        where: { tiendaId, ...(ids && { productoId: { in: ids } }) },
        select: { productoId: true, cantidad: true },
      }),
      this.prometido(tiendaId, ids),
    ]);

    const disponibles = new Map(
      existencias.map((e) => [
        e.productoId,
        Math.max(e.cantidad - (prometido.get(e.productoId) ?? 0), 0),
      ]),
    );
    for (const l of liberadas) {
      if (ids && !ids.includes(l.productoId)) continue;
      disponibles.set(l.productoId, (disponibles.get(l.productoId) ?? 0) + l.cantidad);
    }
    return disponibles;
  }

  /**
   * Lo que la tienda no alcanza a surtir de esas lineas. Vacio es que hay de
   * todo.
   *
   * Lo llaman el punto de venta y el checkout de la app (al recoger en
   * tienda) antes de confirmar un pedido: no se vende lo que no esta en el
   * anaquel.
   */
  async faltantes(
    tiendaId: string,
    lineas: LineaAMover[],
    /** Las de un pedido que se esta corrigiendo (`disponibles`). */
    liberadas: LineaAMover[] = [],
  ): Promise<FaltanteEnTienda[]> {
    const pedidas = new Map<string, number>();
    for (const l of lineas) {
      if (l.cantidad <= 0) continue;
      pedidas.set(l.productoId, (pedidas.get(l.productoId) ?? 0) + l.cantidad);
    }
    const ids = [...pedidas.keys()];
    if (ids.length === 0) return [];

    const [disponibles, productos] = await Promise.all([
      this.disponibles(tiendaId, ids, liberadas),
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
      ...(dto.emisorRfc !== undefined && { emisorRfc: dto.emisorRfc || null }),
      // Se guarda normalizado (los siete dias, los cerrados en null) para que
      // quien lo lea no tenga que adivinar que significa un dia ausente.
      ...(dto.horario !== undefined && {
        horario: dto.horario ? (leerHorario(dto.horario) as Prisma.InputJsonObject) : Prisma.DbNull,
      }),
    };
  }
}
