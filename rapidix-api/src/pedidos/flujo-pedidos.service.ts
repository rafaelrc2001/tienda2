import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorBitacora, EjeBitacora, EstadoPago, EstadoPedido, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { tieneAcceso } from '../auth/permisos';
import { actorDe, ActorDeBitacora, registrarEnBitacora } from './bitacora';
import {
  evaluarAvance,
  NOMBRE_ESTADO_PEDIDO,
  PasoPendiente,
  pasoPendiente,
  PedidoEnFlujo,
  Transicion,
} from './flujo';
import { PedidoDto, PedidosService } from './pedidos.service';

export interface BitacoraDto {
  id: string;
  eje: EjeBitacora;
  estadoAnterior: string | null;
  estadoNuevo: string;
  nota: string | null;
  actor: ActorBitacora;
  actorNombre: string;
  creadoEn: string;
}

/** Un pedido como lo ve una pantalla de trabajo: con su siguiente paso resuelto. */
export type PedidoEnPantallaDto = PedidoDto & { paso: PasoPendiente };

/** Las pestanas de Operaciones. */
export enum FiltroOperaciones {
  /** Lo que Operaciones tiene que mover: de Confirmado a Listo para entrega. */
  ACTIVOS = 'activos',
  /** Ya salio de bodega con un repartidor. */
  EN_RUTA = 'en-ruta',
  ENTREGADOS = 'entregados',
  CANCELADOS = 'cancelados',
}

const NO_CANCELADO: Prisma.PedidoWhereInput = { estadoPago: { not: EstadoPago.CANCELADO } };

const WHERE_OPERACIONES: Record<FiltroOperaciones, Prisma.PedidoWhereInput> = {
  [FiltroOperaciones.ACTIVOS]: {
    ...NO_CANCELADO,
    estado: {
      in: [
        EstadoPedido.CONFIRMADO,
        EstadoPedido.EN_PREPARACION,
        EstadoPedido.PREPARADO,
        EstadoPedido.LISTO_PARA_ENTREGA,
      ],
    },
  },
  [FiltroOperaciones.EN_RUTA]: {
    ...NO_CANCELADO,
    estado: { in: [EstadoPedido.RECOLECTADO, EstadoPedido.EN_RUTA] },
  },
  [FiltroOperaciones.ENTREGADOS]: { ...NO_CANCELADO, estado: EstadoPedido.ENTREGADO },
  [FiltroOperaciones.CANCELADOS]: { estadoPago: EstadoPago.CANCELADO },
};

export interface ListadoOperacionesDto {
  pedidos: PedidoEnPantallaDto[];
  /** Cuantos hay en cada pestana, para pintarlo junto a su nombre. */
  conteos: Record<FiltroOperaciones, number>;
}

/** Nombre de la seccion como se le ensena a quien no puede dar el paso. */
const NOMBRE_SECCION: Record<string, string> = { operaciones: 'Operaciones', rutas: 'Rutas' };

/**
 * Mueve el eje fisico del pedido, un paso a la vez (etapa 2 de Operaciones,
 * Rutas y Finanzas).
 *
 * Las reglas viven en `flujo.ts`; aqui solo se aplican con la fila bloqueada
 * y se deja el renglon de la bitacora en la misma transaccion.
 */
@Injectable()
export class FlujoPedidosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pedidos: PedidosService,
  ) {}

  /**
   * Da el siguiente paso de Operaciones (preparar, dejar listo, entregar en
   * tienda). Los pasos de Rutas no pasan por aqui: llevan sus propios efectos
   * —repartidor, carga del camion, evidencia de entrega— y los aplica su
   * servicio con `aplicar()`.
   */
  async avanzarEnOperaciones(
    id: string,
    destino: EstadoPedido,
    usuario: UsuarioAutenticado,
    nota?: string,
  ): Promise<PedidoEnPantallaDto> {
    await this.prisma.$transaction(async (tx) => {
      const pedido = await FlujoPedidosService.bloquear(tx, id);
      const transicion = FlujoPedidosService.exigirAvance(pedido, destino);

      if (transicion.seccion !== 'operaciones') {
        throw new ConflictException({
          statusCode: 409,
          code: 'PASO_DE_RUTAS',
          message: `El paso a "${NOMBRE_ESTADO_PEDIDO[destino]}" se da desde Rutas.`,
        });
      }
      FlujoPedidosService.exigirSeccion(usuario, transicion);

      await FlujoPedidosService.aplicar(tx, id, transicion, actorDe(usuario), nota);
    });
    return FlujoPedidosService.enPantalla(await this.pedidos.detalle(id));
  }

  /**
   * La pantalla de Operaciones. Los activos van del mas antiguo al mas nuevo,
   * que es el orden en que se surten; el resto, del mas reciente hacia atras.
   */
  async listarOperaciones(
    filtro: FiltroOperaciones,
    limite: number,
  ): Promise<ListadoOperacionesDto> {
    const [pedidos, ...cuentas] = await Promise.all([
      this.pedidos.buscar(
        WHERE_OPERACIONES[filtro],
        { creadoEn: filtro === FiltroOperaciones.ACTIVOS ? 'asc' : 'desc' },
        limite,
      ),
      ...Object.values(FiltroOperaciones).map((f) =>
        this.prisma.pedido.count({ where: WHERE_OPERACIONES[f] }),
      ),
    ]);
    const conteos = Object.fromEntries(
      Object.values(FiltroOperaciones).map((f, i) => [f, cuentas[i]]),
    ) as Record<FiltroOperaciones, number>;

    return { pedidos: pedidos.map((p) => FlujoPedidosService.enPantalla(p)), conteos };
  }

  /** Le pone al pedido su siguiente paso, calculado aqui y no en la interfaz. */
  static enPantalla(pedido: PedidoDto): PedidoEnPantallaDto {
    return {
      ...pedido,
      paso: pasoPendiente({
        estado: pedido.estado,
        estadoPago: pedido.pago.estado,
        metodoEntrega: pedido.metodoEntrega,
        metodoPago: pedido.pago.metodo,
      }),
    };
  }

  /** La historia completa del pedido, de la mas antigua a la mas reciente. */
  async bitacora(id: string): Promise<BitacoraDto[]> {
    const existe = await this.prisma.pedido.count({ where: { id } });
    if (!existe) throw new NotFoundException('Pedido no encontrado');

    const filas = await this.prisma.bitacoraPedido.findMany({
      where: { pedidoId: id },
      orderBy: { creadoEn: 'asc' },
    });
    return filas.map((f) => ({
      id: f.id,
      eje: f.eje,
      estadoAnterior: f.estadoAnterior,
      estadoNuevo: f.estadoNuevo,
      nota: f.nota,
      actor: f.actor,
      actorNombre: f.actorNombre,
      creadoEn: f.creadoEn.toISOString(),
    }));
  }

  /**
   * Bloquea la fila del pedido hasta el final de la transaccion y la lee.
   *
   * Sin el bloqueo, Finanzas podria retener el pago entre que aqui se lee y
   * se escribe, y el pedido avanzaria con un pago que ya no estaba liberado.
   * Con el, el cambio de pago espera a que este termine (o al reves).
   */
  static async bloquearFila(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const filas = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM pedidos WHERE id = ${id} FOR UPDATE
    `;
    if (filas.length === 0) throw new NotFoundException('Pedido no encontrado');
  }

  /** El bloqueo mas lo que necesita el eje fisico. Finanzas lee otras columnas. */
  static async bloquear(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<PedidoEnFlujo & { id: string; folio: string }> {
    await FlujoPedidosService.bloquearFila(tx, id);
    return tx.pedido.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        folio: true,
        estado: true,
        estadoPago: true,
        metodoEntrega: true,
        metodoPago: true,
      },
    });
  }

  /** La transicion a `destino`, o el 409 con el `code` que interpreta la interfaz. */
  static exigirAvance(pedido: PedidoEnFlujo, destino: EstadoPedido): Transicion {
    const resultado = evaluarAvance(pedido, destino);
    if ('bloqueo' in resultado) {
      throw new ConflictException({
        statusCode: 409,
        code: resultado.bloqueo.codigo,
        message: resultado.bloqueo.mensaje,
      });
    }
    return resultado.transicion;
  }

  /**
   * Cada paso es de una seccion. El administrador las tiene todas; Operaciones
   * no puede dar los pasos de Rutas aunque llegue a este punto.
   */
  static exigirSeccion(usuario: UsuarioAutenticado, transicion: Transicion): void {
    if (!tieneAcceso(usuario.rol, transicion.seccion)) {
      throw new ForbiddenException(
        `El paso a "${NOMBRE_ESTADO_PEDIDO[transicion.a]}" le corresponde a ${NOMBRE_SECCION[transicion.seccion] ?? transicion.seccion}.`,
      );
    }
  }

  /**
   * Escribe el paso y su renglon de bitacora. Supone la fila ya bloqueada y
   * la transicion ya validada; el `where` con el estado de origen es la
   * ultima red por si alguien la llama sin bloquear.
   */
  static async aplicar(
    tx: Prisma.TransactionClient,
    id: string,
    transicion: Transicion,
    quien: ActorDeBitacora,
    nota?: string | null,
  ): Promise<void> {
    const { count } = await tx.pedido.updateMany({
      where: { id, estado: transicion.de },
      data: { estado: transicion.a },
    });
    if (count === 0) {
      throw new ConflictException({
        statusCode: 409,
        code: 'PEDIDO_CAMBIO',
        message: 'El pedido cambió mientras tanto. Actualiza la pantalla.',
      });
    }
    await registrarEnBitacora(
      tx,
      id,
      {
        eje: EjeBitacora.PEDIDO,
        estadoAnterior: transicion.de,
        estadoNuevo: transicion.a,
        nota,
      },
      quien,
    );
  }
}
