import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { EstadoPago, EstadoPedido, MetodoEntrega, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { actorDe } from '../pedidos/bitacora';
import { FlujoPedidosService, PedidoEnPantallaDto } from '../pedidos/flujo-pedidos.service';
import { PedidoEnFlujo } from '../pedidos/flujo';
import { PedidosService } from '../pedidos/pedidos.service';

/** La jornada del repartidor tal como la ve su pantalla. */
export interface JornadaDto {
  id: string;
  iniciadaEn: string;
  /** Sellada al "Finalizar entregas"; vuelve a null si la reabre. */
  finalizadaEn: string | null;
  /** Renglones que siguen en el camion. Cero no significa que ya pueda liquidar. */
  piezasEnCamion: number;
}

/** Las pestanas de Rutas. */
export enum FiltroRutas {
  /** Lo que hay en bodega esperando camion. Es de todos hasta que alguien lo toma. */
  DISPONIBLES = 'disponibles',
  /** Lo que lleva encima quien pregunta. */
  EN_CAMION = 'en-camion',
  /** Lo que ya entrego y todavia no ha liquidado: es lo que entrara a su corte. */
  ENTREGADOS = 'entregados',
}

/**
 * La pantalla entera en una sola respuesta: la jornada manda sobre lo que el
 * repartidor puede pulsar, asi que pedirla aparte obligaria a dos viajes en
 * cada refresco de un telefono que trabaja en la calle.
 */
export interface TableroRutasDto {
  /** `null` mientras no haya pulsado "Inicio de entregas". */
  jornada: JornadaDto | null;
  pedidos: PedidoEnPantallaDto[];
  conteos: Record<FiltroRutas, number>;
}

/**
 * Lo que espera en bodega. No se filtra por repartidor: un pedido esta libre
 * hasta que alguien lo recolecta, y quien lo recolecta se lo queda.
 */
const DISPONIBLES: Prisma.PedidoWhereInput = {
  estado: EstadoPedido.LISTO_PARA_ENTREGA,
  metodoEntrega: MetodoEntrega.DOMICILIO,
  repartidorId: null,
  estadoPago: { not: EstadoPago.CANCELADO },
};

/**
 * Administracion -> Rutas: la jornada del repartidor y lo que sube al camion.
 *
 * El paso fisico lo escribe `FlujoPedidosService.aplicar()`, igual que en
 * Operaciones; lo que vive aqui son los efectos que solo tiene Rutas —abrir la
 * jornada, apuntar quien se lleva el pedido y que renglones van en el camion—.
 */
@Injectable()
export class RutasService {
  private readonly logger = new Logger(RutasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pedidos: PedidosService,
  ) {}

  // ----------------------------------------------------------------
  // Pantalla
  // ----------------------------------------------------------------

  async tablero(
    usuario: UsuarioAutenticado,
    filtro: FiltroRutas,
    limite: number,
  ): Promise<TableroRutasDto> {
    const donde = RutasService.filtros(usuario.sub);

    const [jornada, pedidos, ...cuentas] = await Promise.all([
      this.jornada(usuario.sub),
      this.pedidos.buscar(
        donde[filtro],
        // Lo pendiente, del mas antiguo al mas nuevo: es el orden en que se
        // reparte. Lo entregado al reves, que es el orden en que se revisa.
        { creadoEn: filtro === FiltroRutas.ENTREGADOS ? 'desc' : 'asc' },
        limite,
      ),
      ...Object.values(FiltroRutas).map((f) => this.prisma.pedido.count({ where: donde[f] })),
    ]);
    const conteos = Object.fromEntries(
      Object.values(FiltroRutas).map((f, i) => [f, cuentas[i]]),
    ) as Record<FiltroRutas, number>;

    return {
      jornada,
      pedidos: pedidos.map((p) => FlujoPedidosService.enPantalla(p)),
      conteos,
    };
  }

  /** Las tres pestanas. Dos son de quien pregunta; los disponibles son de nadie. */
  private static filtros(repartidorId: string): Record<FiltroRutas, Prisma.PedidoWhereInput> {
    return {
      [FiltroRutas.DISPONIBLES]: DISPONIBLES,
      [FiltroRutas.EN_CAMION]: {
        repartidorId,
        estado: { in: [EstadoPedido.RECOLECTADO, EstadoPedido.EN_RUTA] },
      },
      // Sin liquidar: lo ya cortado pertenece a la jornada de aquel dia y se
      // consulta en su corte, no aqui.
      [FiltroRutas.ENTREGADOS]: {
        repartidorId,
        estado: EstadoPedido.ENTREGADO,
        liquidado: false,
      },
    };
  }

  // ----------------------------------------------------------------
  // Jornada
  // ----------------------------------------------------------------

  /** La jornada sin liquidar del repartidor, este abierta o ya finalizada. */
  async jornada(repartidorId: string): Promise<JornadaDto | null> {
    const sesion = await this.prisma.sesionEntrega.findFirst({
      where: { repartidorId, corteId: null },
    });
    return sesion ? this.aJornadaDto(sesion) : null;
  }

  /**
   * "Inicio de entregas".
   *
   * Reabre la jornada que ya estaba finalizada en vez de crear otra: mientras
   * no haya corte es el mismo dia y el mismo camion, y una segunda jornada
   * partiria en dos lo que tiene que liquidarse junto. Lo que no se puede es
   * abrir una teniendo otra viva; eso es doble pulsacion, no un dia nuevo.
   */
  async abrirJornada(usuario: UsuarioAutenticado): Promise<JornadaDto> {
    const viva = await this.prisma.sesionEntrega.findFirst({
      where: { repartidorId: usuario.sub, corteId: null },
    });

    if (viva?.finalizadaEn === null) {
      throw new ConflictException({
        statusCode: 409,
        code: 'JORNADA_ABIERTA',
        message: 'Ya tienes una jornada de entregas abierta.',
      });
    }

    if (viva) {
      const reabierta = await this.prisma.sesionEntrega.update({
        where: { id: viva.id },
        data: { finalizadaEn: null },
      });
      this.logger.log(`Jornada ${reabierta.id} reabierta por ${usuario.nombre}`);
      return this.aJornadaDto(reabierta);
    }

    try {
      const nueva = await this.prisma.sesionEntrega.create({
        data: { repartidorId: usuario.sub },
      });
      this.logger.log(`Jornada ${nueva.id} iniciada por ${usuario.nombre}`);
      return this.aJornadaDto(nueva);
    } catch (fallo) {
      // El indice parcial `sesiones_entrega_una_viva` es lo que de verdad
      // impide dos jornadas: la comprobacion de arriba solo da el mensaje
      // bueno, y entre ella y esto cabe una segunda pulsacion.
      if (fallo instanceof Prisma.PrismaClientKnownRequestError && fallo.code === 'P2002') {
        throw new ConflictException({
          statusCode: 409,
          code: 'JORNADA_ABIERTA',
          message: 'Ya tienes una jornada de entregas abierta.',
        });
      }
      throw fallo;
    }
  }

  /**
   * "Finalizar entregas": ya no sale nada mas a la calle hoy, pero la jornada
   * sigue viva hasta el corte. No exige el camion vacio a proposito: lo que no
   * se entrego regresa a bodega al liquidar, y esa es justo la razon de cerrar.
   *
   * Pulsarlo dos veces no es un error: deja la misma jornada finalizada.
   */
  async finalizarJornada(usuario: UsuarioAutenticado): Promise<JornadaDto> {
    const jornada = await this.exigirJornada(this.prisma, usuario.sub, { activa: false });
    if (jornada.finalizadaEn) return this.aJornadaDto(jornada);

    const finalizada = await this.prisma.sesionEntrega.update({
      where: { id: jornada.id },
      data: { finalizadaEn: new Date() },
    });
    this.logger.log(`Jornada ${finalizada.id} finalizada por ${usuario.nombre}`);
    return this.aJornadaDto(finalizada);
  }

  /**
   * La jornada sin liquidar, o el 409 que dice que falta pulsar algo.
   *
   * Con `activa` se exige ademas que no este finalizada: cargar el camion
   * despues de haber cerrado el dia dejaria mercancia fuera del corte que ya
   * se iba a hacer.
   */
  private async exigirJornada(
    tx: Prisma.TransactionClient,
    repartidorId: string,
    opciones: { activa: boolean },
  ): Promise<{ id: string; iniciadaEn: Date; finalizadaEn: Date | null }> {
    const jornada = await tx.sesionEntrega.findFirst({
      where: { repartidorId, corteId: null },
    });
    if (!jornada) {
      throw new ConflictException({
        statusCode: 409,
        code: 'SIN_JORNADA',
        message: 'Pulsa "Inicio de entregas" antes de cargar el camión.',
      });
    }
    if (opciones.activa && jornada.finalizadaEn) {
      throw new ConflictException({
        statusCode: 409,
        code: 'JORNADA_FINALIZADA',
        message: 'Ya finalizaste las entregas de hoy. Vuelve a iniciarlas o haz tu corte.',
      });
    }
    return jornada;
  }

  private async aJornadaDto(sesion: {
    id: string;
    iniciadaEn: Date;
    finalizadaEn: Date | null;
  }): Promise<JornadaDto> {
    const piezas = await this.prisma.cargaRepartidor.aggregate({
      where: { sesionId: sesion.id, cerradoEn: null },
      _sum: { cantidadCargada: true },
    });
    return {
      id: sesion.id,
      iniciadaEn: sesion.iniciadaEn.toISOString(),
      finalizadaEn: sesion.finalizadaEn?.toISOString() ?? null,
      piezasEnCamion: piezas._sum.cantidadCargada ?? 0,
    };
  }

  // ----------------------------------------------------------------
  // Camion
  // ----------------------------------------------------------------

  /**
   * "Recolectado": el pedido sube al camion de quien pulsa.
   *
   * Tres efectos en la misma transaccion, ademas del paso:
   *
   *  1. El pedido se queda con su repartidor. El primero que lo toma es el
   *     dueno; los demas ya no lo ven disponible.
   *  2. Cada renglon del pedido abre su fila de `CargaRepartidor` con el precio
   *     congelado, que es lo que luego se compara con lo que el cliente acepte.
   *  3. El paso y su renglon de bitacora, por el camino de siempre.
   */
  async recolectar(
    id: string,
    usuario: UsuarioAutenticado,
    nota?: string,
  ): Promise<PedidoEnPantallaDto> {
    await this.prisma.$transaction(async (tx) => {
      // Dentro de la transaccion: entre la comprobacion y la escritura cabe un
      // corte que deje la jornada liquidada, y la carga colgaria de una jornada
      // ya cerrada.
      const jornada = await this.exigirJornada(tx, usuario.sub, { activa: true });

      const pedido = await this.bloquearParaRutas(tx, id);
      const transicion = FlujoPedidosService.exigirAvance(pedido, EstadoPedido.RECOLECTADO);
      FlujoPedidosService.exigirSeccion(usuario, transicion);
      RutasService.exigirPropio(pedido, usuario);

      try {
        await tx.cargaRepartidor.createMany({
          data: pedido.items.map((item) => ({
            sesionId: jornada.id,
            repartidorId: usuario.sub,
            pedidoId: pedido.id,
            pedidoItemId: item.id,
            productoId: item.productoId,
            cantidadCargada: item.cantidad,
            precioUnitario: item.precioUnitario,
          })),
        });
      } catch (fallo) {
        // `carga_repartidor_item_en_camion`: el renglon ya salio y no ha
        // regresado. Pasa si el pedido se recolecto desde otro telefono.
        if (fallo instanceof Prisma.PrismaClientKnownRequestError && fallo.code === 'P2002') {
          throw new ConflictException({
            statusCode: 409,
            code: 'ITEM_EN_CAMION',
            message: 'Ese pedido ya va en un camión. Actualiza la pantalla.',
          });
        }
        throw fallo;
      }

      await FlujoPedidosService.aplicar(tx, id, transicion, actorDe(usuario), nota);
      await tx.pedido.update({ where: { id }, data: { repartidorId: usuario.sub } });

      this.logger.log(
        `Pedido ${pedido.folio} recolectado por ${usuario.nombre}: ` +
          `${pedido.items.length} renglón(es) al camión`,
      );
    });

    return FlujoPedidosService.enPantalla(await this.pedidos.detalle(id));
  }

  /** "En ruta": el camion sale. Lo unico que cambia es el estado. */
  async marcarEnRuta(
    id: string,
    usuario: UsuarioAutenticado,
    nota?: string,
  ): Promise<PedidoEnPantallaDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.exigirJornada(tx, usuario.sub, { activa: true });

      const pedido = await this.bloquearParaRutas(tx, id);
      const transicion = FlujoPedidosService.exigirAvance(pedido, EstadoPedido.EN_RUTA);
      FlujoPedidosService.exigirSeccion(usuario, transicion);
      RutasService.exigirPropio(pedido, usuario);

      await FlujoPedidosService.aplicar(tx, id, transicion, actorDe(usuario), nota);
    });

    return FlujoPedidosService.enPantalla(await this.pedidos.detalle(id));
  }

  /**
   * Bloquea el pedido y lee de una vez lo que Rutas necesita: el flujo, de
   * quien es y que renglones tiene.
   */
  private async bloquearParaRutas(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<
    PedidoEnFlujo & {
      id: string;
      folio: string;
      repartidorId: string | null;
      items: { id: string; productoId: string; precioUnitario: Prisma.Decimal; cantidad: number }[];
    }
  > {
    await FlujoPedidosService.bloquearFila(tx, id);
    return tx.pedido.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        folio: true,
        estado: true,
        estadoPago: true,
        metodoEntrega: true,
        repartidorId: true,
        items: { select: { id: true, productoId: true, precioUnitario: true, cantidad: true } },
      },
    });
  }

  /**
   * Un pedido lo mueve quien lo lleva encima, y nadie mas.
   *
   * Vale tambien para el administrador, que tiene la seccion: el candado no es
   * de permisos sino de donde esta la mercancia. Marcar "En ruta" un camion en
   * el que no vas es afirmar algo que no te consta.
   */
  private static exigirPropio(
    pedido: { estado: EstadoPedido; repartidorId: string | null },
    usuario: UsuarioAutenticado,
  ): void {
    // Libre: el primero que lo recolecta se lo queda.
    if (pedido.repartidorId === null || pedido.repartidorId === usuario.sub) return;
    throw new ConflictException({
      statusCode: 409,
      code: 'PEDIDO_DE_OTRO',
      message: 'Ese pedido lo lleva otro repartidor.',
    });
  }
}
