import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorBitacora, EjeBitacora, EstadoPago, EstadoPedido, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventarioService } from '../inventario/inventario.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { tieneAcceso } from '../auth/permisos';
import { actorDe, ActorDeBitacora, registrarEnBitacora } from './bitacora';
import {
  evaluarAvance,
  NOMBRE_ESTADO_PEDIDO,
  pagoCubierto,
  PasoPendiente,
  pasoPendiente,
  PedidoEnFlujo,
  Transicion,
} from './flujo';
import { PedidoDto, PedidosService } from './pedidos.service';
import { saldoDelPedido } from './cxc';

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
export type PedidoEnPantallaDto = PedidoDto & {
  paso: PasoPendiente;
  /**
   * Si hoy se podria entregar por el lado del dinero (`pagoCubierto`). Va
   * aparte del `paso` porque el candado vive en el ultimo paso, y sin esto el
   * repartidor lo descubriria en la puerta despues de cargar y salir.
   */
  pagoCubierto: boolean;
};

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

/** Lo que esta por surtir: de Confirmado a Listo para entrega. */
export const ESTADOS_POR_SURTIR: readonly EstadoPedido[] = [
  EstadoPedido.CONFIRMADO,
  EstadoPedido.EN_PREPARACION,
  EstadoPedido.PREPARADO,
  EstadoPedido.LISTO_PARA_ENTREGA,
];

/**
 * Lo que surte bodega. El pedido que se recoge en una tienda no es de esta
 * pantalla: lo prepara y lo entrega esa tienda desde su PDV.
 */
const DE_BODEGA: Prisma.PedidoWhereInput = { tiendaId: null };

const WHERE_OPERACIONES: Record<FiltroOperaciones, Prisma.PedidoWhereInput> = {
  [FiltroOperaciones.ACTIVOS]: {
    ...DE_BODEGA,
    ...NO_CANCELADO,
    estado: { in: [...ESTADOS_POR_SURTIR] },
  },
  [FiltroOperaciones.EN_RUTA]: {
    ...DE_BODEGA,
    ...NO_CANCELADO,
    estado: { in: [EstadoPedido.RECOLECTADO, EstadoPedido.EN_RUTA] },
  },
  [FiltroOperaciones.ENTREGADOS]: {
    ...DE_BODEGA,
    ...NO_CANCELADO,
    estado: EstadoPedido.ENTREGADO,
  },
  [FiltroOperaciones.CANCELADOS]: { ...DE_BODEGA, estadoPago: EstadoPago.CANCELADO },
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
    private readonly inventario: InventarioService,
    private readonly configuracion: ConfiguracionService,
  ) {}

  /**
   * Da el siguiente paso de Operaciones (preparar, dejar listo, entregar en
   * tienda). Los pasos de Rutas no pasan por aqui: llevan sus propios efectos
   * —repartidor, carga del camion, evidencia de entrega— y los aplica su
   * servicio con `aplicar()`.
   *
   * Entregar en tienda es el momento en que la mercancia sale de bodega: con
   * el control de inventario encendido, el pedido entero baja del fisico.
   *
   * El pedido que se recoge en una tienda elegida no avanza por aqui (409
   * `PEDIDO_DE_TIENDA`): lo mueve esa tienda desde su PDV, que es quien lo
   * descuenta de su inventario y no del de bodega.
   */
  async avanzarEnOperaciones(
    id: string,
    destino: EstadoPedido,
    usuario: UsuarioAutenticado,
    nota?: string,
  ): Promise<PedidoEnPantallaDto> {
    const controlInventario = (await this.configuracion.obtener()).controlInventario;

    await this.prisma.$transaction(async (tx) => {
      const pedido = await FlujoPedidosService.bloquear(tx, id);
      if (pedido.tiendaId !== null) {
        throw new ConflictException({
          statusCode: 409,
          code: 'PEDIDO_DE_TIENDA',
          message: `El pedido ${pedido.folio} se recoge en una tienda: lo prepara y lo entrega esa tienda desde su PDV.`,
        });
      }
      const transicion = FlujoPedidosService.exigirAvance(pedido, destino);

      if (transicion.seccion !== 'operaciones') {
        throw new ConflictException({
          statusCode: 409,
          code: 'PASO_DE_RUTAS',
          message: `El paso a "${NOMBRE_ESTADO_PEDIDO[destino]}" se da desde Rutas.`,
        });
      }
      FlujoPedidosService.exigirSeccion(usuario, transicion);

      if (controlInventario && transicion.a === EstadoPedido.ENTREGADO) {
        const lineas = await tx.pedidoItem.findMany({
          where: { pedidoId: id },
          select: { productoId: true, cantidad: true },
        });
        await this.inventario.registrarEntrega(tx, id, pedido.folio, lineas, {
          usuarioId: usuario.sub,
          usuarioNombre: usuario.nombre,
        });
      }

      await FlujoPedidosService.aplicar(tx, id, transicion, actorDe(usuario), nota);

      if (transicion.a === EstadoPedido.ENTREGADO) await FlujoPedidosService.abrirCxc(tx, id);
    });
    return FlujoPedidosService.enPantalla(await this.pedidos.detalle(id));
  }

  /**
   * El pedido a credito que se entrega en tienda es cuenta por cobrar desde
   * ese momento: el cliente ya se llevo la mercancia y debe.
   *
   * El de ruta no pasa por aqui: entra a CXC cuando Finanzas acepta su entrega
   * (`CortesService.aceptarEntrega`), que es cuando se sabe que se entrego de
   * verdad y cuanto. Uno cubierto entero con la billetera no debe nada.
   *
   * Publico porque la tienda que entrega un pedido de la app desde su PDV
   * aplica la misma regla.
   */
  static async abrirCxc(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const pedido = await tx.pedido.findUniqueOrThrow({
      where: { id },
      select: {
        estadoPago: true,
        total: true,
        pagadoConBilletera: true,
        cxcDesde: true,
        pagos: { select: { monto: true } },
      },
    });
    if (pedido.estadoPago !== EstadoPago.CREDITO || pedido.cxcDesde !== null) return;
    if (saldoDelPedido(pedido).isZero()) return;

    await tx.pedido.update({ where: { id }, data: { cxcDesde: new Date() } });
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
      pagoCubierto: pagoCubierto(pedido.pago.metodo, pedido.pago.estado),
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
  ): Promise<PedidoEnFlujo & { id: string; folio: string; tiendaId: string | null }> {
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
        tiendaId: true,
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
