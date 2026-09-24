import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EjeBitacora,
  EstadoPago,
  EstadoPedido,
  MetodoEntrega,
  MotivoDevolucion,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { actorDe, registrarEnBitacora } from '../pedidos/bitacora';
import { FlujoPedidosService, PedidoEnPantallaDto } from '../pedidos/flujo-pedidos.service';
import { NOMBRE_ESTADO_PEDIDO, PedidoEnFlujo } from '../pedidos/flujo';
import { PedidoDto, PedidosService } from '../pedidos/pedidos.service';
import { ListasDePrecio, precioUnitario } from '../catalogo/precios';
import { EntregarPedidoDto, NoEntregadoDto, RenglonEntregadoDto } from './dto/entregar-pedido.dto';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/** Como se lee cada motivo en la bitacora. El catalogo cerrado vive en el enum. */
const NOMBRE_MOTIVO: Readonly<Record<MotivoDevolucion, string>> = {
  [MotivoDevolucion.NO_LO_QUISO]: 'no lo quiso',
  [MotivoDevolucion.DANADO]: 'llegó dañado',
  [MotivoDevolucion.SIN_QUIEN_RECIBA]: 'no había quien recibiera',
  [MotivoDevolucion.PRECIO_EQUIVOCADO]: 'precio equivocado',
};

/** La jornada del repartidor tal como la ve su pantalla. */
export interface JornadaDto {
  id: string;
  iniciadaEn: string;
  /** Sellada al "Finalizar entregas"; vuelve a null si la reabre. */
  finalizadaEn: string | null;
  /** Renglones que siguen en el camion. Cero no significa que ya pueda liquidar. */
  piezasEnCamion: number;
}

/**
 * Un renglon del camion, como lo ve la pantalla de Rutas.
 *
 * Es lo que se cuenta delante del cliente, y no coincide con el renglon del
 * pedido: un mismo item puede haber salido varias veces, asi que aqui esta el
 * historial de intentos y el pedido solo dice lo que se compro.
 */
export interface RenglonDeCargaDto {
  /** El id que hay que mandar al entregar. */
  pedidoItemId: string;
  productoId: string;
  nombre: string;
  unidad: string;
  cantidadCargada: number;
  cantidadEntregada: number;
  cantidadDevuelta: number;
  precioUnitario: number;
  /** Re-cotizado al volumen que acepto el cliente; `null` si manda el de arriba. */
  precioEntregado: number | null;
  motivoDevolucion: MotivoDevolucion | null;
  /** `false` cuando el corte ya lo descargo: es un intento anterior. */
  enCamion: boolean;
}

/**
 * La evidencia de la entrega que cerro el pedido.
 *
 * Solo el id de la foto y no la imagen: la pantalla la pide aparte, cuando
 * alguien abre el detalle, en vez de arrastrarla en cada consulta del tablero.
 */
export interface EvidenciaEntregaDto {
  fotoId: string | null;
  lat: number | null;
  lng: number | null;
  creadoEn: string;
  /** Quien lo entrego. */
  repartidorNombre: string;
}

/** El pedido con lo que de el va —o fue— en el camion. */
export type PedidoEnRutaDto = PedidoEnPantallaDto & {
  carga: RenglonDeCargaDto[];
  /** `null` mientras no se haya entregado. */
  evidencia: EvidenciaEntregaDto | null;
};

/** Como acabo el intento de entrega. Es lo que la pantalla le resume al repartidor. */
export interface ResumenEntregaDto {
  piezasEntregadas: number;
  /** Lo que el cliente no acepto. Sigue en el camion hasta el corte. */
  piezasDevueltas: number;
  /**
   * Lo que se cobra por lo que quedo en casa del cliente, ya con los precios
   * re-cotizados. **No es el total del pedido**: ese no se toca nunca.
   */
  importeEntregado: number;
  parcial: boolean;
}

/** El pedido tras el intento, y como acabo. */
export interface ResultadoEntregaDto {
  pedido: PedidoEnRutaDto;
  entrega: ResumenEntregaDto;
}

/** Un renglon del camion emparejado con lo que el cliente acepto. */
interface RenglonResuelto {
  carga: CargaEnCamion;
  cantidadEntregada: number;
  motivoDevolucion: MotivoDevolucion | null;
}

/** Lo que hace falta saber de una fila de `CargaRepartidor` para cerrarla. */
interface CargaEnCamion {
  id: string;
  pedidoItemId: string;
  productoId: string;
  cantidadCargada: number;
  precioUnitario: Decimal;
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
  pedidos: PedidoEnRutaDto[];
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

    return { jornada, pedidos: await this.conCarga(pedidos), conteos };
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
    // Lo que queda arriba es lo cargado menos lo que se quedo el cliente: una
    // entrega parcial deja el renglon abierto hasta el corte, y sumar solo
    // `cantidadCargada` contaria mercancia que ya no va en el camion.
    const filas = await this.prisma.$queryRaw<{ piezas: number }[]>`
      SELECT COALESCE(SUM("cantidadCargada" - "cantidadEntregada"), 0)::int AS piezas
      FROM carga_repartidor
      WHERE "sesionId" = ${sesion.id} AND "cerradoEn" IS NULL
    `;
    return {
      id: sesion.id,
      iniciadaEn: sesion.iniciadaEn.toISOString(),
      finalizadaEn: sesion.finalizadaEn?.toISOString() ?? null,
      piezasEnCamion: filas[0]?.piezas ?? 0,
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
  ): Promise<PedidoEnRutaDto> {
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

    return this.pedidoConCarga(id);
  }

  /**
   * "Entregado": el cliente se queda con la mercancia y el pedido se cierra.
   *
   * Lo que viaja es lo que **acepto** de cada renglon, que es lo que el
   * repartidor cuenta delante de el. Efectos, todos en la misma transaccion:
   *
   *  1. Cada renglon guarda lo aceptado, su motivo y —si sobro algo— el precio
   *     re-cotizado al volumen que de verdad se lleva.
   *  2. La evidencia (`EntregaPedido`) apunta a las imagenes ya subidas.
   *  3. El paso a ENTREGADO con su renglon de bitacora.
   *
   * Lo que **no** pasa aqui es la vuelta a bodega: la mercancia devuelta sigue
   * fisicamente en el camion hasta el corte, y es el corte quien la descarga
   * (`cantidadDevuelta`, `cerradoEn`) y la reingresa al inventario.
   */
  async entregar(
    id: string,
    dto: EntregarPedidoDto,
    usuario: UsuarioAutenticado,
  ): Promise<ResultadoEntregaDto> {
    let resumen: ResumenEntregaDto;

    await this.prisma.$transaction(async (tx) => {
      await this.exigirJornada(tx, usuario.sub, { activa: true });

      const pedido = await this.bloquearParaRutas(tx, id);
      const transicion = FlujoPedidosService.exigirAvance(pedido, EstadoPedido.ENTREGADO);
      FlujoPedidosService.exigirSeccion(usuario, transicion);
      RutasService.exigirPropio(pedido, usuario);

      const cargas = await this.cargasDelCamion(tx, id);
      const renglones = RutasService.emparejar(cargas, dto.items);
      await RutasService.exigirImagenes(tx, dto);

      // Las listas de precio de hoy: el pedido guarda el unitario que se
      // cobro, no las listas con que se calculo, asi que re-cotizar solo puede
      // hacerse con las vigentes.
      const productos = await tx.producto.findMany({
        where: { id: { in: cargas.map((c) => c.productoId) } },
        select: {
          id: true,
          precioVenta: true,
          piso2: true,
          precio2: true,
          piso3: true,
          precio3: true,
        },
      });
      const listasPorProducto = new Map(productos.map((p) => [p.id, p]));

      let entregadas = 0;
      let devueltas = 0;
      let importe = new Decimal(0);

      for (const { carga, cantidadEntregada, motivoDevolucion } of renglones) {
        const precioEntregado = RutasService.recotizar(
          carga,
          cantidadEntregada,
          listasPorProducto.get(carga.productoId),
        );

        await tx.cargaRepartidor.update({
          where: { id: carga.id },
          data: { cantidadEntregada, motivoDevolucion, precioEntregado },
        });

        entregadas += cantidadEntregada;
        devueltas += carga.cantidadCargada - cantidadEntregada;
        importe = importe.add((precioEntregado ?? carga.precioUnitario).mul(cantidadEntregada));
      }

      if (entregadas === 0) {
        throw new ConflictException({
          statusCode: 409,
          code: 'NADA_ENTREGADO',
          message: 'Si el cliente no aceptó nada, márcalo como "No entregado".',
        });
      }

      await tx.entregaPedido.create({
        data: {
          pedidoId: id,
          repartidorId: usuario.sub,
          fotoId: dto.fotoId ?? null,
          firmaId: dto.firmaId ?? null,
          lat: dto.lat ?? null,
          lng: dto.lng ?? null,
        },
      });

      await FlujoPedidosService.aplicar(
        tx,
        id,
        transicion,
        actorDe(usuario),
        RutasService.nota(
          devueltas > 0 ? `Entrega parcial: ${devueltas} pieza(s) no aceptadas.` : null,
          dto.nota,
        ),
      );

      resumen = {
        piezasEntregadas: entregadas,
        piezasDevueltas: devueltas,
        importeEntregado: importe.toNumber(),
        parcial: devueltas > 0,
      };
      this.logger.log(
        `Pedido ${pedido.folio} entregado por ${usuario.nombre}: ` +
          `${entregadas} pieza(s), $${importe.toString()}` +
          (devueltas > 0 ? `, ${devueltas} devuelta(s)` : ''),
      );
    });

    return {
      pedido: await this.pedidoConCarga(id),
      entrega: resumen!,
    };
  }

  /**
   * "No entregado": el intento que no llego a entrega.
   *
   * El pedido **no cambia de estado**: sigue en el camion, y de ahi lo saca el
   * corte para devolverlo a bodega. Lo que queda es el motivo en cada renglon
   * —de ahi salen los reportes de devolucion— y el renglon de bitacora que
   * cuenta el intento. Intentarlo otra vez el mismo dia pisa el motivo
   * anterior; la bitacora conserva los dos.
   */
  async noEntregar(
    id: string,
    dto: NoEntregadoDto,
    usuario: UsuarioAutenticado,
  ): Promise<ResultadoEntregaDto> {
    let piezas = 0;

    await this.prisma.$transaction(async (tx) => {
      await this.exigirJornada(tx, usuario.sub, { activa: true });

      const pedido = await this.bloquearParaRutas(tx, id);
      RutasService.exigirPropio(pedido, usuario);

      // No hay transicion que validar —el estado no se mueve— asi que el
      // candado se pone a mano: solo se puede no entregar lo que salio a ruta.
      if (pedido.estado !== EstadoPedido.EN_RUTA) {
        throw new ConflictException({
          statusCode: 409,
          code: 'NO_ESTA_EN_RUTA',
          message: `Solo se marca "No entregado" lo que va en ruta, y ese pedido está en "${NOMBRE_ESTADO_PEDIDO[pedido.estado]}".`,
        });
      }

      const cargas = await this.cargasDelCamion(tx, id);
      await tx.cargaRepartidor.updateMany({
        where: { id: { in: cargas.map((c) => c.id) } },
        data: { cantidadEntregada: 0, motivoDevolucion: dto.motivo, precioEntregado: null },
      });
      piezas = cargas.reduce((suma, c) => suma + c.cantidadCargada, 0);

      await registrarEnBitacora(
        tx,
        id,
        {
          eje: EjeBitacora.PEDIDO,
          estadoAnterior: pedido.estado,
          estadoNuevo: pedido.estado,
          nota: RutasService.nota(`No entregado: ${NOMBRE_MOTIVO[dto.motivo]}.`, dto.nota),
        },
        actorDe(usuario),
      );

      this.logger.log(
        `Pedido ${pedido.folio} no entregado (${dto.motivo}) por ${usuario.nombre}: ` +
          `${piezas} pieza(s) siguen en el camión`,
      );
    });

    return {
      pedido: await this.pedidoConCarga(id),
      entrega: {
        piezasEntregadas: 0,
        piezasDevueltas: piezas,
        importeEntregado: 0,
        parcial: false,
      },
    };
  }

  /** "En ruta": el camion sale. Lo unico que cambia es el estado. */
  async marcarEnRuta(
    id: string,
    usuario: UsuarioAutenticado,
    nota?: string,
  ): Promise<PedidoEnRutaDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.exigirJornada(tx, usuario.sub, { activa: true });

      const pedido = await this.bloquearParaRutas(tx, id);
      const transicion = FlujoPedidosService.exigirAvance(pedido, EstadoPedido.EN_RUTA);
      FlujoPedidosService.exigirSeccion(usuario, transicion);
      RutasService.exigirPropio(pedido, usuario);

      await FlujoPedidosService.aplicar(tx, id, transicion, actorDe(usuario), nota);
    });

    return this.pedidoConCarga(id);
  }

  // ----------------------------------------------------------------
  // El pedido con su carga
  // ----------------------------------------------------------------

  /**
   * Le pega a cada pedido lo que de el va en el camion.
   *
   * Va en la misma respuesta porque sin ella la pantalla no puede entregar: el
   * pedido dice lo que se compro, pero el id que hay que contar renglon por
   * renglon —y las cantidades que de verdad subieron— solo estan aqui.
   */
  private async conCarga(pedidos: PedidoDto[]): Promise<PedidoEnRutaDto[]> {
    if (pedidos.length === 0) return [];

    const ids = pedidos.map((p) => p.id);
    const evidencias = await this.evidencias(ids);

    const cargas = await this.prisma.cargaRepartidor.findMany({
      where: { pedidoId: { in: ids } },
      select: {
        pedidoId: true,
        pedidoItemId: true,
        productoId: true,
        cantidadCargada: true,
        cantidadEntregada: true,
        cantidadDevuelta: true,
        precioUnitario: true,
        precioEntregado: true,
        motivoDevolucion: true,
        cerradoEn: true,
        pedidoItem: { select: { nombre: true, unidad: true } },
      },
      orderBy: { creadoEn: 'asc' },
    });

    const porPedido = new Map<string, RenglonDeCargaDto[]>();
    for (const c of cargas) {
      const renglones = porPedido.get(c.pedidoId) ?? [];
      renglones.push({
        pedidoItemId: c.pedidoItemId,
        productoId: c.productoId,
        nombre: c.pedidoItem.nombre,
        unidad: c.pedidoItem.unidad,
        cantidadCargada: c.cantidadCargada,
        cantidadEntregada: c.cantidadEntregada,
        cantidadDevuelta: c.cantidadDevuelta,
        precioUnitario: c.precioUnitario.toNumber(),
        precioEntregado: c.precioEntregado?.toNumber() ?? null,
        motivoDevolucion: c.motivoDevolucion,
        enCamion: c.cerradoEn === null,
      });
      porPedido.set(c.pedidoId, renglones);
    }

    return pedidos.map((pedido) => ({
      ...FlujoPedidosService.enPantalla(pedido),
      carga: porPedido.get(pedido.id) ?? [],
      evidencia: evidencias.get(pedido.id) ?? null,
    }));
  }

  /**
   * La evidencia de la entrega de un pedido, o `null` si no se ha entregado.
   *
   * Aparte del tablero para que la consulten Operaciones y Finanzas —un
   * cliente que dice que no le llego— sin pasar por la pantalla del repartidor.
   */
  async evidencia(pedidoId: string): Promise<EvidenciaEntregaDto | null> {
    const existe = await this.prisma.pedido.count({ where: { id: pedidoId } });
    if (!existe) throw new NotFoundException('Pedido no encontrado');
    return (await this.evidencias([pedidoId])).get(pedidoId) ?? null;
  }

  private async evidencias(ids: string[]): Promise<Map<string, EvidenciaEntregaDto>> {
    const entregas = await this.prisma.entregaPedido.findMany({
      where: { pedidoId: { in: ids } },
      select: {
        pedidoId: true,
        fotoId: true,
        lat: true,
        lng: true,
        creadoEn: true,
        repartidor: { select: { nombre: true } },
      },
    });
    return new Map(
      entregas.map((e) => [
        e.pedidoId,
        {
          fotoId: e.fotoId,
          lat: e.lat?.toNumber() ?? null,
          lng: e.lng?.toNumber() ?? null,
          creadoEn: e.creadoEn.toISOString(),
          repartidorNombre: e.repartidor.nombre,
        },
      ]),
    );
  }

  /** El pedido que acaba de moverse, tal y como lo espera la pantalla. */
  private async pedidoConCarga(id: string): Promise<PedidoEnRutaDto> {
    const [pedido] = await this.conCarga([await this.pedidos.detalle(id)]);
    return pedido;
  }

  // ----------------------------------------------------------------
  // Cerrar una entrega
  // ----------------------------------------------------------------

  /** Los renglones del pedido que siguen arriba del camion. */
  private async cargasDelCamion(
    tx: Prisma.TransactionClient,
    pedidoId: string,
  ): Promise<CargaEnCamion[]> {
    const cargas = await tx.cargaRepartidor.findMany({
      where: { pedidoId, cerradoEn: null },
      select: {
        id: true,
        pedidoItemId: true,
        productoId: true,
        cantidadCargada: true,
        precioUnitario: true,
      },
      orderBy: { creadoEn: 'asc' },
    });
    if (cargas.length === 0) {
      throw new ConflictException({
        statusCode: 409,
        code: 'SIN_CARGA',
        message: 'Ese pedido no va en tu camión. Actualiza la pantalla.',
      });
    }
    return cargas;
  }

  /**
   * Cruza lo que manda la pantalla con lo que hay en el camion.
   *
   * Se exigen **todos** los renglones y ninguno de mas: una entrega es el
   * recuento completo de lo que baja del camion, y dar por entregado en
   * silencio lo que no viene convertiria un olvido de la interfaz en mercancia
   * cobrada.
   */
  private static emparejar(
    cargas: CargaEnCamion[],
    items: RenglonEntregadoDto[],
  ): RenglonResuelto[] {
    const porItem = new Map(cargas.map((c) => [c.pedidoItemId, c]));
    const vistos = new Set<string>();
    const renglones: RenglonResuelto[] = [];

    for (const item of items) {
      const carga = porItem.get(item.pedidoItemId);
      if (!carga || vistos.has(item.pedidoItemId)) {
        throw new ConflictException({
          statusCode: 409,
          code: 'RENGLON_DESCONOCIDO',
          message: 'Ese renglón no va en tu camión. Actualiza la pantalla.',
        });
      }
      vistos.add(item.pedidoItemId);

      if (item.cantidadEntregada > carga.cantidadCargada) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'CANTIDAD_DE_MAS',
          message: `No puedes entregar más de las ${carga.cantidadCargada} pieza(s) que subiste.`,
        });
      }

      // El motivo acompana a lo que sobra, y solo a eso: un motivo en un
      // renglon completo seria un dato que despues nadie sabe leer.
      const falta = carga.cantidadCargada - item.cantidadEntregada;
      if (falta > 0 && !item.motivoDevolucion) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'FALTA_MOTIVO',
          message: 'Di por qué el cliente no aceptó todo el renglón.',
        });
      }
      if (falta === 0 && item.motivoDevolucion) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MOTIVO_DE_MAS',
          message: 'Ese renglón se entregó completo: no lleva motivo de devolución.',
        });
      }

      renglones.push({
        carga,
        cantidadEntregada: item.cantidadEntregada,
        motivoDevolucion: item.motivoDevolucion ?? null,
      });
    }

    if (renglones.length !== cargas.length) {
      throw new ConflictException({
        statusCode: 409,
        code: 'RENGLONES_INCOMPLETOS',
        message: `Faltan renglones por contar: el camión lleva ${cargas.length} de este pedido.`,
      });
    }
    return renglones;
  }

  /**
   * El precio de lo que el cliente si acepto.
   *
   * `null` significa "manda el precio congelado del pedido", y es lo normal:
   * entrega completa, o el mismo escalon. Solo cambia cuando llevarse menos
   * piezas rompe el volumen con el que se cotizo —quien pide 10 al precio de
   * 10 y acepta 6 no compro 10—.
   *
   * Se re-cotiza con las listas **vigentes** del producto porque el pedido
   * guarda el unitario que se cobro, no las listas con que se calculo. Si el
   * negocio cambio de precios entre el pedido y la entrega, el escalon nuevo
   * es lo unico que hay; si el producto ya no existe, manda el congelado.
   */
  private static recotizar(
    carga: CargaEnCamion,
    cantidadEntregada: number,
    listas: ListasDePrecio | undefined,
  ): Decimal | null {
    if (cantidadEntregada === carga.cantidadCargada || cantidadEntregada === 0) return null;
    if (!listas) return null;

    const recotizado = precioUnitario(listas, cantidadEntregada);
    return recotizado.equals(carga.precioUnitario) ? null : recotizado;
  }

  /**
   * Las imagenes tienen que existir y estar en la carpeta de entregas. Sin
   * esto, `fotoId` seria un texto cualquiera y la evidencia apuntaria a nada.
   */
  private static async exigirImagenes(
    tx: Prisma.TransactionClient,
    dto: EntregarPedidoDto,
  ): Promise<void> {
    const ids = [...new Set([dto.fotoId, dto.firmaId].filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return;

    const encontradas = await tx.imagen.count({ where: { id: { in: ids }, carpeta: 'entregas' } });
    if (encontradas !== ids.length) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'IMAGEN_NO_ENCONTRADA',
        message: 'La foto o la firma no se subieron bien. Vuelve a intentarlo.',
      });
    }
  }

  /** Une lo que cuenta el sistema con lo que escribio el repartidor. */
  private static nota(automatica: string | null, escrita?: string): string | null {
    return [automatica, escrita?.trim() || null].filter(Boolean).join(' ') || null;
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
