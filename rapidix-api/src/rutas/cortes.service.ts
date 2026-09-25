import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EjeBitacora, EstadoCorte, EstadoPedido, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { InventarioService } from '../inventario/inventario.service';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { actorDe, ActorDeBitacora, registrarEnBitacora } from '../pedidos/bitacora';
import { devueltoDelRenglon, efectivoDelPedido } from './dinero-del-corte';
import { CerrarCorteDto, RecibirCorteDto, RegistrarAbonoDto } from './dto/corte.dto';

const Decimal = Prisma.Decimal;

/** Un pedido dentro del corte: lo que trae de el y lo que regresa. */
export interface PedidoDelCorteDto {
  id: string;
  folio: string;
  clienteNombre: string;
  estado: EstadoPedido;
  /** Efectivo que trae por este pedido. Cero en transferencia o crédito. */
  efectivo: number;
  /** Piezas que vuelven a bodega. */
  devueltas: number;
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
}

/**
 * Lo que abarca el corte de una entrega. La ultima entrega viva se lleva
 * ademas lo que no tiene entrega (pedidos cargados antes de que existieran),
 * para que nada quede en el camion al cerrar la jornada.
 */
interface AlcanceDelCorte {
  sesionId: string;
  finalizadaEn: Date | null;
  cierraJornada: boolean;
  pedidos: Prisma.PedidoWhereInput;
  cargas: Prisma.CargaRepartidorWhereInput;
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
   *     que devuelve y se cierra, y esas piezas vuelven a bodega.
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

      await this.descargarCamion(tx, alcance.cargas, quien, controlInventario);

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
    const cierraJornada = otrasVivas === 0;

    return {
      sesionId: entrega.sesionId,
      finalizadaEn: entrega.finalizadaEn,
      cierraJornada,
      pedidos: cierraJornada
        ? { OR: [{ entregaRutaId: entregaId }, { entregaRutaId: null }] }
        : { entregaRutaId: entregaId },
      cargas: {
        sesionId: entrega.sesionId,
        cerradoEn: null,
        ...(!cierraJornada && { pedido: { entregaRutaId: entregaId } }),
      },
    };
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
   * La aritmetica esta en `dinero-del-corte.ts`, aparte y probada: aqui solo
   * se juntan las filas. Se usa igual para previsualizar y para cerrar, para
   * que el numero que vio no sea otro que el que se guarda.
   */
  private async calcular(
    tx: Prisma.TransactionClient,
    repartidorId: string,
    alcance: AlcanceDelCorte,
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
        cliente: { select: { nombre: true } },
        cargas: {
          where: { cerradoEn: null },
          select: {
            cantidadCargada: true,
            cantidadEntregada: true,
            precioUnitario: true,
            precioEntregado: true,
          },
        },
      },
      orderBy: { creadoEn: 'asc' },
    });

    let total = new Decimal(0);
    let piezas = 0;
    let regresan = 0;

    const detalle = pedidos.map((pedido) => {
      // Solo el dinero de lo que se entrego: un pedido que vuelve entero no
      // cobra nada, y su `efectivoDelPedido` sale cero porque no acepto nada.
      const efectivo =
        pedido.estado === EstadoPedido.ENTREGADO
          ? efectivoDelPedido(pedido, pedido.cargas)
          : new Decimal(0);
      const devueltas = pedido.cargas.reduce((suma, c) => suma + devueltoDelRenglon(c), 0);

      total = total.add(efectivo);
      piezas += devueltas;
      if (pedido.estado !== EstadoPedido.ENTREGADO) regresan++;

      return {
        id: pedido.id,
        folio: pedido.folio,
        clienteNombre: pedido.cliente.nombre,
        estado: pedido.estado,
        efectivo: efectivo.toNumber(),
        devueltas,
      };
    });

    return {
      montoCalculado: total.toNumber(),
      pedidos: detalle,
      piezasQueRegresan: piezas,
      pedidosQueRegresan: regresan,
      cierraJornada: alcance.cierraJornada,
    };
  }

  /**
   * Baja del camion lo que queda de la entrega: escribe lo devuelto en cada
   * renglon, lo cierra, lo reingresa a bodega y devuelve a la cola los pedidos
   * que no se llegaron a entregar.
   */
  private async descargarCamion(
    tx: Prisma.TransactionClient,
    donde: Prisma.CargaRepartidorWhereInput,
    quien: ActorDeBitacora,
    controlInventario: boolean,
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

    const ahora = new Date();
    const porPedido = new Map<
      string,
      { folio: string; estado: EstadoPedido; lineas: { productoId: string; cantidad: number }[] }
    >();

    for (const carga of cargas) {
      const devueltas = carga.cantidadCargada - carga.cantidadEntregada;
      await tx.cargaRepartidor.update({
        where: { id: carga.id },
        data: { cantidadDevuelta: devueltas, cerradoEn: ahora },
      });

      if (devueltas <= 0) continue;
      const pedido = porPedido.get(carga.pedidoId) ?? {
        folio: carga.pedido.folio,
        estado: carga.pedido.estado,
        lineas: [],
      };
      pedido.lineas.push({ productoId: carga.productoId, cantidad: devueltas });
      porPedido.set(carga.pedidoId, pedido);
    }

    for (const [pedidoId, pedido] of porPedido) {
      // Con el control apagado no se toca el saldo, igual que en el checkout:
      // devolver a una bodega que nadie ha capturado inventaria existencia.
      if (controlInventario) {
        await this.inventario.devolverDeRuta(tx, pedidoId, pedido.folio, pedido.lineas, {
          usuarioId: quien.actorId,
          usuarioNombre: quien.actorNombre,
        });
      }

      // **El unico retroceso del eje fisico.** No pasa por `TRANSICIONES`
      // porque no es un paso adelante sino la constatacion de que la mercancia
      // volvio: el pedido esta otra vez en bodega esperando camion, y suelta a
      // su repartidor y su entrega para que manana entre a otra.
      if (pedido.estado !== EstadoPedido.ENTREGADO) {
        await tx.pedido.update({
          where: { id: pedidoId },
          data: {
            estado: EstadoPedido.LISTO_PARA_ENTREGA,
            repartidorId: null,
            entregaRutaId: null,
          },
        });
        await registrarEnBitacora(
          tx,
          pedidoId,
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
   * **Quien recibe no puede ser quien cerro.** Se comprueba aqui para dar el
   * mensaje bueno, pero quien de verdad lo impide es el `CHECK` de la base: el
   * que trae el dinero no se lo cuenta a si mismo.
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
    if (corte.repartidorId === usuario.sub) {
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
    const corte = await this.prisma.corte.findUnique({ where: { id } });
    if (!corte) throw new NotFoundException('Corte no encontrado');

    if (corte.estado !== EstadoCorte.RECIBIDO) {
      throw new ConflictException({
        statusCode: 409,
        code: 'CORTE_SIN_RECIBIR',
        message: 'Recibe el corte antes de registrar abonos: primero hay que contar el dinero.',
      });
    }

    await this.prisma.corteAbono.create({
      data: {
        corteId: id,
        monto: new Decimal(dto.monto),
        registradoPorId: usuario.sub,
        nota: dto.nota?.trim() || null,
      },
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
    const pendiente =
      corte.montoRecibido === null
        ? new Decimal(0)
        : Decimal.max(0, corte.montoCalculado.sub(corte.montoRecibido).sub(abonado));

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
