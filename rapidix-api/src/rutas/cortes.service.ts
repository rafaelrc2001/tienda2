import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  EjeBitacora,
  EstadoCorte,
  EstadoPago,
  EstadoPedido,
  MetodoEntrega,
  MetodoPago,
  MotivoDevolucion,
  Prisma,
  RolUsuario,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { InventarioService } from '../inventario/inventario.service';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { actorDe, ActorDeBitacora, registrarEnBitacora } from '../pedidos/bitacora';
import {
  AlcanceDelCorte,
  alcanceDelCorte,
  cuentaDelCorte,
  planDeDescarga,
} from './alcance-del-corte';
import { PedidosService } from '../pedidos/pedidos.service';
import { CerrarCorteDto, RecibirCorteDto, RegistrarAbonoDto } from './dto/corte.dto';
import { GenerarFaltanteDto } from './dto/faltante.dto';
import {
  ConteoDeProducto,
  conteoPorProducto,
  esDevolucion,
  faltanteQueNoCabe,
  indicadoresDeRuta,
  indicadoresDelHistorial,
  intentoDeEntrega,
  ProductoDeLaLinea,
  productosDeLaLinea,
  renglonDelFaltante,
  ResultadoDelIntento,
  saldoDelCorte,
  TOLERANCIA,
} from './liquidacion-de-ruta';

const Decimal = Prisma.Decimal;

/** El "telefono" del cliente "Venta en ruta": no es un numero, nadie entra con el. */
const TELEFONO_VENTA_EN_RUTA = 'venta-en-ruta';

/** Un pedido dentro del corte: lo que trae de el y lo que regresa. */
export interface PedidoDelCorteDto {
  id: string;
  folio: string;
  clienteNombre: string;
  estado: EstadoPedido;
  estadoPago: EstadoPago;
  metodoPago: MetodoPago;
  /** Regresa a bodega (`esDevolucion`): va en la otra lista de Liquidacion. */
  devolucion: boolean;
  /** Nacio de "Generar pedido x faltante" en esta misma liquidacion. */
  porFaltante: boolean;
  /** Efectivo que trae por este pedido. Cero en transferencia o crédito. */
  efectivo: number;
  /** Piezas que vuelven a bodega. */
  devueltas: number;
  /** La linea de productos: lo aceptado en una entrega, lo cargado en una devolucion. */
  productos: ProductoDeLaLinea[];
}

/** Lo que el repartidor ve antes de declarar, y lo que queda escrito al cerrar. */
export interface ResumenCorteDto {
  /** Lo que dice el sistema que trae. */
  montoCalculado: number;
  pedidos: PedidoDelCorteDto[];
  piezasQueRegresan: number;
  /** Pedidos que no se entregaron y vuelven a bodega para salir otro día. */
  pedidosQueRegresan: number;
  /** Es la ultima entrega viva: su corte cierra tambien la jornada. */
  cierraJornada: boolean;
  /** Lo que baja del camion por producto: cargado, entregado y devolucion. */
  conteo: ConteoDeProducto[];
}

/** El encabezado de cada entrega: sus pedidos y el efectivo que pide su corte. */
export interface IndicadoresRutaDto {
  pedidos: number;
  entregados: number;
  devoluciones: number;
  /** La suma de lo que dira cada corte: sale de lo entregado, no del total. */
  efectivoEsperado: number;
}

/** Una entrega en el historial del repartidor, con su corte si ya lo tiene. */
export interface EntregaEnHistorialDto {
  id: string;
  numero: number;
  nombre: string | null;
  creadoEn: string;
  iniciadaEn: string | null;
  finalizadaEn: string | null;
  /** Los que salieron en ella, incluidos los que regresaron a bodega. */
  pedidos: number;
  corte: CorteDto | null;
}

/** Un pedido tal como salio en una entrega del historial. */
export interface PedidoEnHistorialDto {
  id: string;
  folio: string;
  clienteNombre: string;
  total: number;
  resultado: ResultadoDelIntento;
  renglones: {
    nombre: string;
    unidad: string;
    cantidad: number;
    /** `null` mientras el pedido no cierra. */
    recibido: number | null;
    motivo: MotivoDevolucion | null;
  }[];
}

export interface DetalleHistorialDto {
  pedidos: PedidoEnHistorialDto[];
  conteo: ConteoDeProducto[];
}

export interface CorteDto {
  id: string;
  repartidorId: string;
  repartidorNombre: string;
  cerradoEn: string;
  montoCalculado: number;
  montoDeclarado: number;
  montoRecibido: number | null;
  /** Declarado menos calculado: negativo es faltante. */
  diferencia: number;
  /** Lo que falta por entregar tras contar el dinero y sus abonos. */
  saldoPendiente: number;
  recibidoEn: string | null;
  recibidoPorNombre: string | null;
  estado: EstadoCorte;
  notas: string | null;
  /** La entrega que liquida. `null` en los cortes de jornada entera de antes. */
  entrega: { numero: number; nombre: string | null } | null;
  abonos: {
    id: string;
    monto: number;
    registradoPorNombre: string;
    nota: string | null;
    creadoEn: string;
  }[];
  pedidos: number;
}

/** Las pestanas de Cortes en Finanzas. */
export enum FiltroCortes {
  POR_RECIBIR = 'por-recibir',
  RECIBIDOS = 'recibidos',
}

const WHERE_CORTES: Record<FiltroCortes, Prisma.CorteWhereInput> = {
  [FiltroCortes.POR_RECIBIR]: { estado: EstadoCorte.CERRADO },
  [FiltroCortes.RECIBIDOS]: { estado: EstadoCorte.RECIBIDO },
};

export interface ListadoCortesDto {
  cortes: CorteDto[];
  conteos: Record<FiltroCortes, number>;
}

const INCLUIR_CORTE = {
  repartidor: { select: { nombre: true } },
  recibidoPor: { select: { nombre: true } },
  abonos: {
    orderBy: { creadoEn: 'asc' },
    include: { registradoPor: { select: { nombre: true } } },
  },
  entregas: { select: { numero: true, nombre: true }, take: 1 },
  _count: { select: { pedidos: true } },
} satisfies Prisma.CorteInclude;

type CorteCompleto = Prisma.CorteGetPayload<{ include: typeof INCLUIR_CORTE }>;

/**
 * El cierre de cada entrega: el dinero que el repartidor entrega y la
 * mercancia que regresa a bodega. El de la ultima entrega cierra la jornada.
 *
 * Es el unico sitio que descarga el camion. Hasta aqui, lo que el cliente no
 * acepto seguia fisicamente arriba: la entrega solo lo apunto.
 */
@Injectable()
export class CortesService {
  private readonly logger = new Logger(CortesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventario: InventarioService,
    private readonly configuracion: ConfiguracionService,
  ) {}

  // ----------------------------------------------------------------
  // El corte del repartidor
  // ----------------------------------------------------------------

  /**
   * Lo que el sistema dice que trae, antes de que declare.
   *
   * La pantalla lo ensena para que el repartidor cuente contra un numero, no
   * contra su memoria. No cambia nada: se puede pedir las veces que haga falta.
   */
  async previsualizar(usuario: UsuarioAutenticado, entregaId: string): Promise<ResumenCorteDto> {
    const alcance = await this.alcance(this.prisma, usuario.sub, entregaId);
    return this.calcular(this.prisma, usuario.sub, alcance);
  }

  /**
   * Corta una entrega.
   *
   * Un corte **nace cerrado**: el repartidor ya no lo toca salvo para corregir
   * lo declarado, y de ahi solo puede pasar a recibido por Finanzas. Todo pasa
   * en una transaccion:
   *
   *  1. Se calcula lo que trae de esta entrega, con la jornada bloqueada.
   *  2. Nace el corte con lo calculado y lo declarado, uno al lado del otro.
   *  3. Los pedidos entregados de la entrega quedan liquidados y atados a el.
   *  4. **Se descarga su parte del camion**: cada renglon abierto escribe lo
   *     que devuelve y se cierra. Lo que un cliente rechazo vuelve a estar
   *     disponible para venta; el fisico no se mueve porque nunca bajo.
   *  5. Lo que no se entrego regresa a "Listo para entrega" y suelta a su
   *     repartidor, para que pueda salir en otra entrega.
   *  6. La entrega queda atada al corte; si era la ultima viva, la jornada
   *     tambien, y deja de estar viva.
   */
  async cerrar(
    usuario: UsuarioAutenticado,
    entregaId: string,
    dto: CerrarCorteDto,
  ): Promise<CorteDto> {
    const quien = actorDe(usuario);
    const controlInventario = (await this.configuracion.obtener()).controlInventario;

    const corteId = await this.prisma.$transaction(async (tx) => {
      // Se bloquea la jornada, no solo la entrega: dos cortes de entregas
      // distintas a la vez podrian creer cada uno que queda la otra, y la
      // jornada no se cerraria nunca.
      const entrega = await tx.entregaRuta.findFirst({
        where: { id: entregaId, repartidorId: usuario.sub },
        select: { sesionId: true },
      });
      if (entrega) {
        await tx.$queryRaw`SELECT id FROM sesiones_entrega WHERE id = ${entrega.sesionId} FOR UPDATE`;
      }

      const alcance = await this.alcance(tx, usuario.sub, entregaId);
      const resumen = await this.calcular(tx, usuario.sub, alcance);

      const corte = await tx.corte.create({
        data: {
          repartidorId: usuario.sub,
          montoCalculado: new Decimal(resumen.montoCalculado),
          montoDeclarado: new Decimal(dto.montoDeclarado),
          notas: dto.notas?.trim() || null,
        },
      });

      // Lo cobrado como faltante en esta entrega, por producto. Se lee antes de
      // liquidar: despues ya no se distingue de lo de otros cortes.
      const itemsFaltantes = await tx.pedidoItem.findMany({
        where: {
          pedido: {
            ...alcance.pedidos,
            repartidorId: usuario.sub,
            porFaltante: true,
            liquidado: false,
          },
        },
        select: { productoId: true, cantidad: true },
      });
      const faltantes = new Map<string, number>();
      for (const item of itemsFaltantes) {
        faltantes.set(item.productoId, (faltantes.get(item.productoId) ?? 0) + item.cantidad);
      }

      // Lo entregado entra al corte como dinero. `liquidado` es lo que impide
      // que vuelva a contarse manana: el filtro de "entregados" lo mira.
      const ahora = new Date();
      await tx.pedido.updateMany({
        where: {
          ...alcance.pedidos,
          repartidorId: usuario.sub,
          estado: EstadoPedido.ENTREGADO,
          liquidado: false,
        },
        data: { liquidado: true, liquidadoEn: ahora, corteId: corte.id },
      });

      await this.descargarCamion(tx, alcance.cargas, quien, controlInventario, faltantes);

      await tx.entregaRuta.update({
        where: { id: entregaId },
        data: { corteId: corte.id, finalizadaEn: alcance.finalizadaEn ?? ahora },
      });

      // La ultima entrega se lleva la jornada: atada a su corte, ya no es "la viva".
      if (alcance.cierraJornada) {
        const jornada = await tx.sesionEntrega.findUniqueOrThrow({
          where: { id: alcance.sesionId },
        });
        await tx.sesionEntrega.update({
          where: { id: jornada.id },
          data: { corteId: corte.id, finalizadaEn: jornada.finalizadaEn ?? ahora },
        });
      }

      this.logger.log(
        `Corte ${corte.id} de ${usuario.nombre} (entrega ${entregaId}): calculado ` +
          `$${resumen.montoCalculado}, declarado $${dto.montoDeclarado}, ` +
          `${resumen.piezasQueRegresan} pieza(s) a bodega` +
          (alcance.cierraJornada ? ', cierra la jornada' : ''),
      );
      return corte.id;
    });

    return this.detalle(corteId);
  }

  /**
   * "Generar pedido x faltante": el repartidor conto al bajar del camion menos
   * de lo que el sistema dice que regresa, y lo que falta se le cobra.
   *
   * Nace una venta en efectivo a nombre de "Venta en ruta", ya ENTREGADA y en
   * esta misma entrega, sin liquidar: `calcular` la suma al efectivo del corte
   * y su producto cuenta como entregado en el conteo. El precio es el de
   * catalogo (lista 1) y lo pone la API. No se puede pedir mas de lo que
   * regresa: eso ya se entrego o nunca subio.
   *
   * Devuelve el resumen del corte ya con el pedido, para repintar sin otra
   * peticion.
   */
  async generarFaltante(
    usuario: UsuarioAutenticado,
    entregaId: string,
    dto: GenerarFaltanteDto,
  ): Promise<ResumenCorteDto> {
    const quien = actorDe(usuario);
    const controlInventario = (await this.configuracion.obtener()).controlInventario;

    return this.prisma.$transaction(async (tx) => {
      // La misma jornada bloqueada que el corte: un faltante no puede colarse
      // mientras otra pestana esta cerrando esta entrega.
      const entrega = await tx.entregaRuta.findFirst({
        where: { id: entregaId, repartidorId: usuario.sub },
        select: { sesionId: true },
      });
      if (entrega) {
        await tx.$queryRaw`SELECT id FROM sesiones_entrega WHERE id = ${entrega.sesionId} FOR UPDATE`;
      }

      const alcance = await this.alcance(tx, usuario.sub, entregaId);
      const antes = await this.calcular(tx, usuario.sub, alcance);

      const noCabe = faltanteQueNoCabe(antes.conteo, dto.lineas);
      if (noCabe) {
        throw new ConflictException({
          statusCode: 409,
          code: 'FALTANTE_EXCEDE_DEVOLUCION',
          message:
            noCabe.regresa === 0
              ? `${noCabe.nombre ?? 'Ese producto'} no regresa del camión: no puede faltar.`
              : `De ${noCabe.nombre} regresan ${noCabe.regresa}: ` +
                `no pueden faltar ${noCabe.cantidad}.`,
        });
      }

      // Una linea por producto, aunque la pantalla mande el mismo dos veces.
      const cantidades = new Map<string, number>();
      for (const l of dto.lineas) {
        cantidades.set(l.productoId, (cantidades.get(l.productoId) ?? 0) + l.cantidad);
      }
      const productos = await tx.producto.findMany({
        where: { id: { in: [...cantidades.keys()] } },
        select: {
          id: true,
          nombre: true,
          unidad: true,
          precioVenta: true,
          categoria: { select: { nombre: true } },
        },
      });
      const lineas = productos.map((p) => ({
        productoId: p.id,
        nombre: p.nombre,
        categoria: p.categoria.nombre,
        unidad: p.unidad,
        precioUnitario: p.precioVenta,
        cantidad: cantidades.get(p.id)!,
      }));
      const total = lineas.reduce(
        (suma, l) => suma.add(new Decimal(l.precioUnitario).mul(l.cantidad)),
        new Decimal(0),
      );

      const cliente = await this.clienteVentaEnRuta(tx);
      const folio = await PedidosService.siguienteFolio(tx);
      const pedido = await tx.pedido.create({
        data: {
          folio,
          clienteId: cliente.id,
          subtotal: total,
          envio: 0,
          total,
          metodoPago: MetodoPago.EFECTIVO,
          estadoPago: EstadoPago.PAGO_PENDIENTE,
          // Sin envio: la mercancia ya iba en el camion.
          metodoEntrega: MetodoEntrega.TIENDA,
          estado: EstadoPedido.ENTREGADO,
          direccion: {},
          repartidorId: usuario.sub,
          entregaRutaId: entregaId,
          porFaltante: true,
          items: { create: lineas },
        },
      });

      if (controlInventario) {
        await this.inventario.registrarFaltanteDeRuta(tx, pedido.id, folio, lineas, {
          usuarioId: quien.actorId,
          usuarioNombre: quien.actorNombre,
        });
      }

      const nota = 'Faltante al liquidar la entrega: lo paga el repartidor en su corte.';
      await registrarEnBitacora(
        tx,
        pedido.id,
        {
          eje: EjeBitacora.PEDIDO,
          estadoAnterior: null,
          estadoNuevo: EstadoPedido.ENTREGADO,
          nota,
        },
        quien,
      );
      await registrarEnBitacora(
        tx,
        pedido.id,
        { eje: EjeBitacora.PAGO, estadoAnterior: null, estadoNuevo: EstadoPago.PAGO_PENDIENTE },
        quien,
      );

      this.logger.log(
        `Pedido por faltante ${folio} de ${usuario.nombre} (entrega ${entregaId}): ` +
          `$${total.toFixed(2)}`,
      );
      return this.calcular(tx, usuario.sub, alcance);
    });
  }

  /**
   * El cliente a cuyo nombre quedan los pedidos por faltante. Se crea la
   * primera vez que hace falta. Su telefono no es un numero, asi que nadie
   * puede entrar con el, y no recibe campanias.
   */
  private async clienteVentaEnRuta(tx: Prisma.TransactionClient): Promise<{ id: string }> {
    return tx.cliente.upsert({
      where: { telefono: TELEFONO_VENTA_EN_RUTA },
      update: {},
      create: { nombre: 'Venta en ruta', telefono: TELEFONO_VENTA_EN_RUTA, notificaciones: false },
      select: { id: true },
    });
  }

  /** La entrega que se corta y lo que abarca, o el 404/409 que lo impide. */
  private async alcance(
    tx: Prisma.TransactionClient,
    repartidorId: string,
    entregaId: string,
  ): Promise<AlcanceDelCorte> {
    const entrega = await tx.entregaRuta.findFirst({
      where: { id: entregaId, repartidorId },
      include: { sesion: { select: { corteId: true } } },
    });
    if (!entrega) throw new NotFoundException('Entrega no encontrada');
    if (entrega.corteId !== null || entrega.sesion.corteId !== null) {
      throw new ConflictException({
        statusCode: 409,
        code: 'ENTREGA_CORTADA',
        message: 'Esa entrega ya tiene su corte.',
      });
    }

    const otrasVivas = await tx.entregaRuta.count({
      where: { sesionId: entrega.sesionId, corteId: null, id: { not: entregaId } },
    });
    return alcanceDelCorte({
      entregaId,
      sesionId: entrega.sesionId,
      finalizadaEn: entrega.finalizadaEn,
      otrasVivas,
    });
  }

  /**
   * Corrige lo declarado mientras el corte siga cerrado.
   *
   * Una vez que Finanzas lo recibe ya no se toca: el declarado es lo que el
   * repartidor dijo que traia **antes** de que lo contaran, y cambiarlo
   * despues borraria la diferencia que justamente hay que explicar.
   */
  async corregirDeclarado(
    corteId: string,
    usuario: UsuarioAutenticado,
    dto: CerrarCorteDto,
  ): Promise<CorteDto> {
    const corte = await this.prisma.corte.findUnique({ where: { id: corteId } });
    if (!corte) throw new NotFoundException('Corte no encontrado');

    if (corte.repartidorId !== usuario.sub) {
      throw new ConflictException({
        statusCode: 409,
        code: 'CORTE_DE_OTRO',
        message: 'Ese corte es de otro repartidor.',
      });
    }
    if (corte.estado !== EstadoCorte.CERRADO) {
      throw new ConflictException({
        statusCode: 409,
        code: 'CORTE_RECIBIDO',
        message: 'Finanzas ya recibió ese corte: lo declarado ya no se puede cambiar.',
      });
    }

    await this.prisma.corte.update({
      where: { id: corteId },
      data: {
        montoDeclarado: new Decimal(dto.montoDeclarado),
        ...(dto.notas !== undefined && { notas: dto.notas?.trim() || null }),
      },
    });
    return this.detalle(corteId);
  }

  /**
   * Suma lo que el repartidor trae y cuenta lo que regresa.
   *
   * La aritmetica esta en `alcance-del-corte.ts` y `dinero-del-corte.ts`,
   * aparte y probada: aqui solo se juntan las filas. Se usa igual para previsualizar y para cerrar, para
   * que el numero que vio no sea otro que el que se guarda.
   */
  private async calcular(
    tx: Prisma.TransactionClient,
    repartidorId: string,
    alcance: Pick<AlcanceDelCorte, 'pedidos' | 'cierraJornada'>,
  ): Promise<ResumenCorteDto> {
    const pedidos = await tx.pedido.findMany({
      where: {
        ...alcance.pedidos,
        repartidorId,
        liquidado: false,
        estado: { in: [EstadoPedido.ENTREGADO, EstadoPedido.RECOLECTADO, EstadoPedido.EN_RUTA] },
      },
      select: {
        id: true,
        folio: true,
        estado: true,
        metodoPago: true,
        estadoPago: true,
        total: true,
        pagadoConBilletera: true,
        porFaltante: true,
        cliente: { select: { nombre: true } },
        // Solo los lee el pedido por faltante, que no tiene renglones de camion.
        items: { select: { productoId: true, nombre: true, unidad: true, cantidad: true } },
        cargas: {
          where: { cerradoEn: null },
          select: {
            productoId: true,
            cantidadCargada: true,
            cantidadEntregada: true,
            precioUnitario: true,
            precioEntregado: true,
            pedidoItem: { select: { nombre: true, unidad: true } },
          },
          orderBy: { creadoEn: 'asc' },
        },
      },
      orderBy: { creadoEn: 'asc' },
    });

    // El efectivo sale del total del pedido, que la entrega ya dejo en lo que
    // el cliente se quedo; el faltante, sin cargas, trae el suyo.
    const cuenta = cuentaDelCorte(pedidos);
    const conNombre = (c: (typeof pedidos)[number]['cargas'][number]) => ({
      ...c,
      nombre: c.pedidoItem.nombre,
      unidad: c.pedidoItem.unidad,
    });
    // El pedido por faltante no subio al camion: sus productos cuentan como
    // entregados y bajan la devolucion en lo que ya se cobro.
    const renglones = (pedido: (typeof pedidos)[number]) =>
      pedido.porFaltante
        ? pedido.items.map(renglonDelFaltante)
        : pedido.cargas.map(conNombre);
    return {
      montoCalculado: cuenta.montoCalculado.toNumber(),
      pedidos: pedidos.map((pedido, i) => {
        const devolucion = esDevolucion(pedido);
        return {
          id: pedido.id,
          folio: pedido.folio,
          clienteNombre: pedido.cliente.nombre,
          estado: pedido.estado,
          estadoPago: pedido.estadoPago,
          metodoPago: pedido.metodoPago,
          devolucion,
          porFaltante: pedido.porFaltante,
          efectivo: cuenta.porPedido[i].efectivo.toNumber(),
          devueltas: cuenta.porPedido[i].devueltas,
          productos: productosDeLaLinea(devolucion, renglones(pedido)),
        };
      }),
      piezasQueRegresan: cuenta.piezasQueRegresan,
      pedidosQueRegresan: cuenta.pedidosQueRegresan,
      cierraJornada: alcance.cierraJornada,
      conteo: conteoPorProducto(pedidos.flatMap(renglones)),
    };
  }

  // ----------------------------------------------------------------
  // Lo que el repartidor consulta
  // ----------------------------------------------------------------

  /**
   * El encabezado de una entrega. Mientras vive es la misma cuenta que su
   * corte —el mismo alcance—, para que el efectivo esperado sea justo lo que
   * pedira. Ya cortada, se lee de como acabo cada pedido en ella y del monto
   * que quedo escrito en su corte: lo liquidado ya no entra en `calcular`.
   */
  async indicadores(usuario: UsuarioAutenticado, entregaId: string): Promise<IndicadoresRutaDto> {
    const entrega = await this.prisma.entregaRuta.findFirst({
      where: { id: entregaId, repartidorId: usuario.sub },
      select: {
        corteId: true,
        sesion: { select: { corteId: true } },
        corte: { select: { montoCalculado: true } },
      },
    });
    if (!entrega) throw new NotFoundException('Entrega no encontrada');

    if (entrega.corteId === null && entrega.sesion.corteId === null) {
      const alcance = await this.alcance(this.prisma, usuario.sub, entregaId);
      const resumen = await this.calcular(this.prisma, usuario.sub, alcance);
      return {
        ...indicadoresDeRuta(resumen.pedidos),
        efectivoEsperado: resumen.montoCalculado,
      };
    }

    // Una entrega de una jornada cortada entera (cortes de antes) no tiene
    // corte propio: su dinero quedo en el de la jornada y aqui va en cero.
    const { pedidos } = await this.detalleHistorial(usuario, entregaId);
    return {
      ...indicadoresDelHistorial(pedidos.map((p) => p.resultado)),
      efectivoEsperado: entrega.corte?.montoCalculado.toNumber() ?? 0,
    };
  }

  /**
   * Las entregas del repartidor, de la mas reciente a la mas vieja, con su
   * corte. Incluye las vivas: el historial dice tambien "sin liquidar".
   */
  async historial(
    usuario: UsuarioAutenticado,
    limite: number,
  ): Promise<{ entregas: EntregaEnHistorialDto[] }> {
    const entregas = await this.prisma.entregaRuta.findMany({
      where: { repartidorId: usuario.sub },
      orderBy: { creadoEn: 'desc' },
      take: limite,
      include: { corte: { include: INCLUIR_CORTE } },
    });
    if (entregas.length === 0) return { entregas: [] };

    // Los que salieron: los que siguen atados a la entrega mas los que ya
    // regresaron a bodega, que solo recuerda su renglon del camion.
    const ids = entregas.map((e) => e.id);
    const [atados, cargados] = await Promise.all([
      this.prisma.pedido.findMany({
        where: { entregaRutaId: { in: ids } },
        select: { id: true, entregaRutaId: true },
      }),
      this.prisma.cargaRepartidor.findMany({
        where: { entregaRutaId: { in: ids } },
        select: { pedidoId: true, entregaRutaId: true },
        distinct: ['entregaRutaId', 'pedidoId'],
      }),
    ]);
    const salieron = new Map<string, Set<string>>();
    for (const [entregaId, pedidoId] of [
      ...atados.map((p) => [p.entregaRutaId, p.id] as const),
      ...cargados.map((c) => [c.entregaRutaId, c.pedidoId] as const),
    ]) {
      if (!entregaId) continue;
      const set = salieron.get(entregaId) ?? new Set<string>();
      set.add(pedidoId);
      salieron.set(entregaId, set);
    }

    return {
      entregas: entregas.map((e) => ({
        id: e.id,
        numero: e.numero,
        nombre: e.nombre,
        creadoEn: e.creadoEn.toISOString(),
        iniciadaEn: e.iniciadaEn?.toISOString() ?? null,
        finalizadaEn: e.finalizadaEn?.toISOString() ?? null,
        pedidos: salieron.get(e.id)?.size ?? 0,
        corte: e.corte ? CortesService.aDto(e.corte) : null,
      })),
    };
  }

  /**
   * Lo que salio en una entrega y como acabo cada pedido ahi, con el conteo de
   * lo que bajo del camion. Se lee de los renglones del camion y no del pedido:
   * el pedido que regreso ya no apunta a esta entrega.
   */
  async detalleHistorial(
    usuario: UsuarioAutenticado,
    entregaId: string,
  ): Promise<DetalleHistorialDto> {
    const entrega = await this.prisma.entregaRuta.findFirst({
      where: { id: entregaId, repartidorId: usuario.sub },
      select: { id: true },
    });
    if (!entrega) throw new NotFoundException('Entrega no encontrada');

    const cargas = await this.prisma.cargaRepartidor.findMany({
      where: { entregaRutaId: entregaId },
      orderBy: { creadoEn: 'asc' },
      select: {
        pedidoId: true,
        productoId: true,
        cantidadCargada: true,
        cantidadEntregada: true,
        motivoDevolucion: true,
        cerradoEn: true,
        pedidoItem: { select: { nombre: true, unidad: true } },
        pedido: {
          select: {
            folio: true,
            total: true,
            estado: true,
            estadoPago: true,
            entregaRutaId: true,
            cliente: { select: { nombre: true } },
          },
        },
      },
    });

    const porPedido = new Map<string, typeof cargas>();
    for (const carga of cargas) {
      porPedido.set(carga.pedidoId, [...(porPedido.get(carga.pedidoId) ?? []), carga]);
    }

    const pedidos = [...porPedido.entries()].map(([id, suyas]) => {
      const pedido = suyas[0].pedido;
      const intento = intentoDeEntrega(pedido, entregaId, suyas);
      return {
        id,
        folio: pedido.folio,
        clienteNombre: pedido.cliente.nombre,
        total: pedido.total.toNumber(),
        resultado: intento.resultado,
        renglones: intento.renglones.map((r, i) => ({
          nombre: suyas[i].pedidoItem.nombre,
          unidad: suyas[i].pedidoItem.unidad,
          ...r,
        })),
      };
    });

    return {
      pedidos,
      conteo: conteoPorProducto(
        cargas.map((c) => ({ ...c, nombre: c.pedidoItem.nombre, unidad: c.pedidoItem.unidad })),
      ),
    };
  }

  /**
   * "Completar el faltante" desde el historial del repartidor: el mismo abono
   * que registra Finanzas, pero solo sobre un corte suyo. Queda con su nombre
   * y su hora, que es lo que Finanzas revisa.
   */
  async abonarPropio(
    id: string,
    dto: RegistrarAbonoDto,
    usuario: UsuarioAutenticado,
  ): Promise<CorteDto> {
    const corte = await this.prisma.corte.findUnique({
      where: { id },
      select: { repartidorId: true },
    });
    if (!corte) throw new NotFoundException('Corte no encontrado');
    if (corte.repartidorId !== usuario.sub) {
      throw new ConflictException({
        statusCode: 409,
        code: 'CORTE_DE_OTRO',
        message: 'Ese corte es de otro repartidor.',
      });
    }
    return this.abonar(id, dto, usuario);
  }

  /**
   * Baja del camion lo que queda de la entrega: escribe lo devuelto en cada
   * renglon, lo cierra, libera para venta lo rechazado en la puerta y devuelve
   * a la cola los pedidos que no se llegaron a entregar.
   */
  private async descargarCamion(
    tx: Prisma.TransactionClient,
    donde: Prisma.CargaRepartidorWhereInput,
    quien: ActorDeBitacora,
    controlInventario: boolean,
    /** Lo ya cobrado como faltante: no bajo del camion y no se libera. */
    faltantes: ReadonlyMap<string, number>,
  ): Promise<void> {
    const cargas = await tx.cargaRepartidor.findMany({
      where: donde,
      select: {
        id: true,
        pedidoId: true,
        productoId: true,
        cantidadCargada: true,
        cantidadEntregada: true,
        pedido: { select: { folio: true, estado: true } },
      },
    });

    const plan = planDeDescarga(cargas, controlInventario, faltantes);

    const ahora = new Date();
    for (const cierre of plan.cierres) {
      await tx.cargaRepartidor.update({
        where: { id: cierre.id },
        data: { cantidadDevuelta: cierre.cantidadDevuelta, cerradoEn: ahora },
      });
    }

    for (const pedido of plan.pedidos) {
      if (pedido.liberaInventario) {
        await this.inventario.devolverDeRuta(tx, pedido.pedidoId, pedido.folio, pedido.lineas, {
          usuarioId: quien.actorId,
          usuarioNombre: quien.actorNombre,
        });
      }

      // **El unico retroceso del eje fisico.** No pasa por `TRANSICIONES`
      // porque no es un paso adelante sino la constatacion de que la mercancia
      // volvio: el pedido esta otra vez en bodega esperando camion, y suelta a
      // su repartidor y su entrega para que manana entre a otra.
      if (pedido.vuelveACola) {
        await tx.pedido.update({
          where: { id: pedido.pedidoId },
          data: {
            estado: EstadoPedido.LISTO_PARA_ENTREGA,
            repartidorId: null,
            entregaRutaId: null,
          },
        });
        await registrarEnBitacora(
          tx,
          pedido.pedidoId,
          {
            eje: EjeBitacora.PEDIDO,
            estadoAnterior: pedido.estado,
            estadoNuevo: EstadoPedido.LISTO_PARA_ENTREGA,
            nota: 'Regresó a bodega en el corte: vuelve a salir otro día.',
          },
          quien,
        );
      }
    }
  }

  // ----------------------------------------------------------------
  // Finanzas
  // ----------------------------------------------------------------

  async listar(filtro: FiltroCortes, limite: number): Promise<ListadoCortesDto> {
    const [cortes, ...cuentas] = await Promise.all([
      this.prisma.corte.findMany({
        where: WHERE_CORTES[filtro],
        orderBy: { cerradoEn: 'desc' },
        take: limite,
        include: INCLUIR_CORTE,
      }),
      ...Object.values(FiltroCortes).map((f) =>
        this.prisma.corte.count({ where: WHERE_CORTES[f] }),
      ),
    ]);
    const conteos = Object.fromEntries(
      Object.values(FiltroCortes).map((f, i) => [f, cuentas[i]]),
    ) as Record<FiltroCortes, number>;

    return { cortes: cortes.map((c) => CortesService.aDto(c)), conteos };
  }

  async detalle(id: string): Promise<CorteDto> {
    const corte = await this.prisma.corte.findUnique({ where: { id }, include: INCLUIR_CORTE });
    if (!corte) throw new NotFoundException('Corte no encontrado');
    return CortesService.aDto(corte);
  }

  /**
   * Finanzas cuenta el dinero y cierra el corte.
   *
   * **Quien recibe no puede ser quien cerro**, salvo el administrador: el que
   * trae el dinero no se lo cuenta a si mismo, pero un negocio con un solo
   * usuario (el administrador, que reparte y cuenta) no podria recibir nunca un corte.
   * Por eso la regla vive solo aqui: la base no sabe de roles y se quito su
   * `CHECK` (migracion `admin_recibe_su_corte`).
   *
   * Contar de menos no bloquea nada: el corte queda recibido con su faltante a
   * la vista, y lo que el repartidor entregue despues entra como abono. Lo que
   * no se puede es recibir dos veces.
   */
  async recibir(id: string, dto: RecibirCorteDto, usuario: UsuarioAutenticado): Promise<CorteDto> {
    const corte = await this.prisma.corte.findUnique({ where: { id } });
    if (!corte) throw new NotFoundException('Corte no encontrado');

    if (corte.estado !== EstadoCorte.CERRADO) {
      throw new ConflictException({
        statusCode: 409,
        code: 'CORTE_RECIBIDO',
        message: 'Ese corte ya se recibió.',
      });
    }
    if (corte.repartidorId === usuario.sub && usuario.rol !== RolUsuario.ADMINISTRADOR) {
      throw new ConflictException({
        statusCode: 409,
        code: 'RECIBE_EL_MISMO',
        message: 'No puedes recibir tu propio corte: tiene que contarlo alguien más.',
      });
    }

    await this.prisma.corte.update({
      where: { id },
      data: {
        montoRecibido: new Decimal(dto.montoRecibido),
        recibidoEn: new Date(),
        recibidoPorId: usuario.sub,
        estado: EstadoCorte.RECIBIDO,
        ...(dto.notas?.trim() && {
          notas: [corte.notas, `Al recibir: ${dto.notas.trim()}`].filter(Boolean).join(' · '),
        }),
      },
    });

    this.logger.log(
      `Corte ${id} recibido por ${usuario.nombre}: contó $${dto.montoRecibido} ` +
        `de $${corte.montoCalculado.toString()} calculados`,
    );
    return this.detalle(id);
  }

  /**
   * Lo que el repartidor entrega despues, cuando al recibir falto dinero.
   *
   * Va en una fila aparte en vez de corregir `montoRecibido`: los montos del
   * corte son la fotografia de lo que paso ese dia, y reescribirlos borraria
   * que hubo un faltante.
   */
  async abonar(id: string, dto: RegistrarAbonoDto, usuario: UsuarioAutenticado): Promise<CorteDto> {
    await this.prisma.$transaction(async (tx) => {
      // Bloqueado: dos abonos a la vez leerian el mismo saldo y juntos lo pasarian.
      await tx.$queryRaw`SELECT id FROM cortes WHERE id = ${id} FOR UPDATE`;
      const corte = await tx.corte.findUnique({
        where: { id },
        include: { abonos: { select: { monto: true } } },
      });
      if (!corte) throw new NotFoundException('Corte no encontrado');

      if (corte.estado !== EstadoCorte.RECIBIDO) {
        throw new ConflictException({
          statusCode: 409,
          code: 'CORTE_SIN_RECIBIR',
          message: 'Recibe el corte antes de registrar abonos: primero hay que contar el dinero.',
        });
      }

      // Un abono salda lo que falta, no crea saldo a favor: lo que sobre es
      // otro asunto y no tiene donde quedar escrito.
      const saldo = saldoDelCorte(
        corte.montoCalculado,
        corte.montoRecibido,
        corte.abonos.reduce((suma, a) => suma.add(a.monto), new Decimal(0)),
      );
      if (new Decimal(dto.monto).gt(saldo.add(TOLERANCIA))) {
        throw new ConflictException({
          statusCode: 409,
          code: 'ABONO_EXCEDE_FALTANTE',
          message: saldo.isZero()
            ? 'Ese corte ya está saldado: no hay nada que abonar.'
            : `El abono pasa de lo que falta: quedan $${saldo.toFixed(2)}.`,
        });
      }

      await tx.corteAbono.create({
        data: {
          corteId: id,
          monto: new Decimal(dto.monto),
          registradoPorId: usuario.sub,
          nota: dto.nota?.trim() || null,
        },
      });
    });
    return this.detalle(id);
  }

  /**
   * El corte como lo lee una pantalla.
   *
   * `diferencia` compara lo declarado con lo calculado —lo que el repartidor
   * creia traer frente a lo que el sistema dice— y `saldoPendiente` lo que
   * falta de verdad: lo calculado menos lo contado y sus abonos. Hasta que
   * Finanzas cuenta, no hay saldo que reclamar.
   */
  private static aDto(corte: CorteCompleto): CorteDto {
    const abonado = corte.abonos.reduce((suma, a) => suma.add(a.monto), new Decimal(0));
    const pendiente = saldoDelCorte(corte.montoCalculado, corte.montoRecibido, abonado);

    return {
      id: corte.id,
      repartidorId: corte.repartidorId,
      repartidorNombre: corte.repartidor.nombre,
      cerradoEn: corte.cerradoEn.toISOString(),
      montoCalculado: corte.montoCalculado.toNumber(),
      montoDeclarado: corte.montoDeclarado.toNumber(),
      montoRecibido: corte.montoRecibido?.toNumber() ?? null,
      diferencia: corte.montoDeclarado.sub(corte.montoCalculado).toNumber(),
      saldoPendiente: pendiente.toNumber(),
      recibidoEn: corte.recibidoEn?.toISOString() ?? null,
      recibidoPorNombre: corte.recibidoPor?.nombre ?? null,
      estado: corte.estado,
      notas: corte.notas,
      entrega: corte.entregas[0] ?? null,
      abonos: corte.abonos.map((a) => ({
        id: a.id,
        monto: a.monto.toNumber(),
        registradoPorNombre: a.registradoPor.nombre,
        nota: a.nota,
        creadoEn: a.creadoEn.toISOString(),
      })),
      pedidos: corte._count.pedidos,
    };
  }
}
