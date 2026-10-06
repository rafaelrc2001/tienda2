import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ConceptoIngreso,
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
  alcanceDeLaDescarga,
  AlcanceDelCorte,
  alcanceDelCorte,
  cuentaDelCorte,
  planDeDescarga,
} from './alcance-del-corte';
import { PedidosService } from '../pedidos/pedidos.service';
import { precioUnitario } from '../catalogo/precios';
import {
  CerrarCorteDto,
  CorregirDeclaradoDto,
  RechazarDevolucionDto,
  RegistrarAbonoDto,
} from './dto/corte.dto';
import { GenerarFaltanteDto } from './dto/faltante.dto';
import {
  ConteoDeProducto,
  conteoPorProducto,
  conteoQueNoCuadra,
  esDevolucion,
  faltanteQueNoCabe,
  indicadoresDeRuta,
  indicadoresDelHistorial,
  intentoDeEntrega,
  ProductoDeLaLinea,
  productosDeLaLinea,
  renglonDelFaltante,
  ResultadoDelIntento,
} from './liquidacion-de-ruta';
import { abonoPendiente, adeudoDelCorte, estadoTrasAceptar, TOLERANCIA } from './estado-del-corte';
import { IngresosService } from '../ingresos/ingresos.service';
import { FinanzasService } from '../pedidos/finanzas.service';
import { pagadoDelPedido } from '../pedidos/cxc';
import { destinoAlAceptar, DestinoDelPedido } from './dinero-del-corte';

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
  /**
   * Es la ultima entrega de la jornada que faltaba por liquidar. La jornada
   * no se cierra aqui sino cuando Finanzas acepta su devolucion.
   */
  cierraJornada: boolean;
  /** Lo que baja del camion por producto: cargado, entregado y devolucion. */
  conteo: ConteoDeProducto[];
  /**
   * Por que Finanzas rechazo la devolucion la ultima vez que se liquido esta
   * entrega, o `null`. Es lo que el repartidor tiene que corregir.
   */
  rechazoDevolucion: string | null;
}

/** El alcance del corte, con lo que el servicio sabe ademas de la entrega. */
type AlcanceConEntrega = AlcanceDelCorte & { rechazoDevolucion: string | null };

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
  /** Folio de reparto (`REP000123`). */
  folio: string;
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
  metodoPago: MetodoPago;
  estadoPago: EstadoPago;
  /** Nacio de "Generar pedido x faltante": no subio al camion. */
  porFaltante: boolean;
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
  /**
   * El adeudo del repartidor: lo calculado menos el dinero aceptado y los
   * abonos aceptados. Cero mientras Finanzas no acepte el dinero.
   */
  saldoPendiente: number;
  /** Cuando se acepto el dinero de la liquidacion, y quien. */
  recibidoEn: string | null;
  recibidoPorNombre: string | null;
  /** "Aceptar devolucion": cuando bajo la mercancia del camion, y quien la vio. */
  devolucionAceptadaEn: string | null;
  devolucionAceptadaPorNombre: string | null;
  /** "Entrega aceptada". */
  entregaAceptadaEn: string | null;
  entregaAceptadaPorNombre: string | null;
  /**
   * Lo que "Aceptar dinero" aceptaria ahora: lo declarado si el dinero de la
   * liquidacion sigue sin aceptar, el abono pendiente si lo hay, o `null` si no
   * hay dinero esperando.
   */
  dineroPorAceptar: number | null;
  estado: EstadoCorte;
  notas: string | null;
  /**
   * La entrega que liquida, con su folio de reparto. `null` en los cortes de
   * jornada entera de antes, que no tienen entrega propia ni por tanto folio.
   */
  entrega: { id: string; folio: string; numero: number; nombre: string | null } | null;
  abonos: {
    id: string;
    monto: number;
    registradoPorNombre: string;
    nota: string | null;
    creadoEn: string;
    /** `null` mientras Finanzas no lo acepte: aun no cuenta contra el adeudo. */
    aceptadoEn: string | null;
  }[];
  pedidos: number;
}

/** Un corte abierto en Finanzas: con lo que salio en su entrega y lo que baja. */
export interface DetalleCorteDto extends DetalleHistorialDto {
  corte: CorteDto;
}

/** Las pestanas de Cortes de ruta en Finanzas: una por estatus. */
export enum FiltroCortes {
  /** Liquidados: hay una devolucion, un dinero o un abono esperando. */
  POR_ACEPTAR = 'por-aceptar',
  /** Aceptados en los que el repartidor todavia debe. */
  CON_ADEUDO = 'con-adeudo',
  CERRADOS = 'cerrados',
}

const WHERE_CORTES: Record<FiltroCortes, Prisma.CorteWhereInput> = {
  [FiltroCortes.POR_ACEPTAR]: { estado: EstadoCorte.LIQUIDADO },
  [FiltroCortes.CON_ADEUDO]: { estado: EstadoCorte.ACEPTADO },
  [FiltroCortes.CERRADOS]: { estado: EstadoCorte.CERRADO },
};

export interface ListadoCortesDto {
  cortes: CorteDto[];
  conteos: Record<FiltroCortes, number>;
}

const INCLUIR_CORTE = {
  repartidor: { select: { nombre: true } },
  recibidoPor: { select: { nombre: true } },
  devolucionAceptadaPor: { select: { nombre: true } },
  entregaAceptadaPor: { select: { nombre: true } },
  abonos: {
    orderBy: { creadoEn: 'asc' },
    include: { registradoPor: { select: { nombre: true } } },
  },
  entregas: { select: { id: true, folio: true, numero: true, nombre: true }, take: 1 },
  _count: { select: { pedidos: true } },
} satisfies Prisma.CorteInclude;

type CorteCompleto = Prisma.CorteGetPayload<{ include: typeof INCLUIR_CORTE }>;

/**
 * El cierre de cada entrega: el dinero que el repartidor entrega y la
 * mercancia que regresa a bodega.
 *
 * Va por partes y cada una tiene su dueno. El repartidor **liquida** (cuenta
 * lo que baja y declara su dinero) y Finanzas **acepta**: primero la
 * devolucion, que es cuando el camion se descarga de verdad, y despues el
 * dinero.
 *
 * Es el unico sitio que descarga el camion. Hasta que Finanzas acepta la
 * devolucion, lo que el cliente no acepto sigue contando arriba: la entrega
 * solo lo apunto y la liquidacion solo lo conto.
 */
@Injectable()
export class CortesService {
  private readonly logger = new Logger(CortesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventario: InventarioService,
    private readonly configuracion: ConfiguracionService,
    private readonly ingresos: IngresosService,
    private readonly finanzas: FinanzasService,
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
   * "Finalizar liquidacion": liquida una entrega.
   *
   * Un corte **nace liquidado**: el repartidor ya no lo toca salvo para
   * corregir lo declarado, y de ahi lo que sigue es de Finanzas. Todo pasa en
   * una transaccion:
   *
   *  1. Se calcula lo que trae de esta entrega, con la jornada bloqueada, y
   *     se comprueba que lo que conto al bajar es lo que regresa
   *     (`conteoQueNoCuadra`): si no, 409 `CONTEO_NO_CUADRA` y no se cierra
   *     nada.
   *  2. Nace el corte con lo calculado y lo declarado, uno al lado del otro.
   *  3. Los pedidos entregados de la entrega quedan liquidados y atados a el.
   *  4. La entrega queda atada al corte, y se olvida el motivo por el que su
   *     devolucion se hubiera rechazado antes.
   *
   * Lo que **no** pasa aqui es la descarga: los renglones del camion siguen
   * abiertos, nada vuelve al inventario, los pedidos que no se entregaron
   * siguen en la entrega y la jornada sigue abierta. Todo eso lo hace
   * `aceptarDevolucion()`, cuando alguien distinto del repartidor ya vio la
   * mercancia. Por eso deshacer una liquidacion rechazada es barato: no hay
   * inventario que desandar.
   */
  async cerrar(
    usuario: UsuarioAutenticado,
    entregaId: string,
    dto: CerrarCorteDto,
  ): Promise<CorteDto> {
    const corteId = await this.prisma.$transaction(async (tx) => {
      // Se bloquea la jornada, no solo la entrega: dos cortes de entregas
      // distintas a la vez podrian creer cada uno que es el ultimo y llevarse
      // los dos lo que no tiene entrega.
      const entrega = await tx.entregaRuta.findFirst({
        where: { id: entregaId, repartidorId: usuario.sub },
        select: { sesionId: true },
      });
      if (entrega) {
        await tx.$queryRaw`SELECT id FROM sesiones_entrega WHERE id = ${entrega.sesionId} FOR UPDATE`;
      }

      const alcance = await this.alcance(tx, usuario.sub, entregaId);
      const resumen = await this.calcular(tx, usuario.sub, alcance);

      // Lo que vuelve al fisico es la devolucion del conteo: sin contarla, o
      // contando de menos sin cobrar el faltante, entraria al estante
      // mercancia que nadie vio bajar. El dinero que no cuadra no bloquea; la
      // mercancia si.
      const descuadre = conteoQueNoCuadra(resumen.conteo, dto.devueltos);
      if (descuadre) {
        throw new ConflictException({
          statusCode: 409,
          code: 'CONTEO_NO_CUADRA',
          message:
            descuadre.devuelto === null
              ? `Falta contar ${descuadre.nombre}: regresan ${descuadre.devolucion} ${descuadre.unidad}.`
              : `De ${descuadre.nombre} regresan ${descuadre.devolucion} ${descuadre.unidad} y ` +
                `contaste ${descuadre.devuelto}. Si faltan, genera antes el pedido por faltante.`,
        });
      }

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

      // La jornada no se toca: sigue viva hasta que se acepte la devolucion.
      await tx.entregaRuta.update({
        where: { id: entregaId },
        data: {
          corteId: corte.id,
          finalizadaEn: alcance.finalizadaEn ?? ahora,
          rechazoDevolucion: null,
          rechazoDevolucionEn: null,
        },
      });

      this.logger.log(
        `Corte ${corte.id} de ${usuario.nombre} (entrega ${entregaId}) liquidado: ` +
          `calculado $${resumen.montoCalculado}, declarado $${dto.montoDeclarado}, ` +
          `${resumen.piezasQueRegresan} pieza(s) por devolver`,
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
   * y su producto cuenta como entregado en el conteo. El precio lo pone la API
   * con las listas de precio de hoy (`precioUnitario`), segun cuantas piezas
   * faltan de ese producto. No se puede pedir mas de lo que regresa: eso ya se
   * entrego o nunca subio.
   *
   * No escribe ningun movimiento de inventario, y por eso cancelarlo despues
   * no devuelve mercancia: lo que falto no esta en bodega.
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
          piso2: true,
          precio2: true,
          piso3: true,
          precio3: true,
          categoria: { select: { nombre: true } },
        },
      });
      // El precio sale de las listas, con lo que falta de ese producto como
      // volumen: es la misma cuenta que cobraria esas piezas en un pedido.
      const lineas = productos.map((p) => {
        const cantidad = cantidades.get(p.id)!;
        return {
          productoId: p.id,
          nombre: p.nombre,
          categoria: p.categoria.nombre,
          unidad: p.unidad,
          precioUnitario: precioUnitario(p, cantidad),
          cantidad,
        };
      });
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

      // No toca el inventario: sus piezas salieron del fisico al recolectarse
      // y siguen en ruta hasta que el corte cierre los renglones, que ya no
      // las devuelve al estante ni las libera (`planDeDescarga`).

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
  ): Promise<AlcanceConEntrega> {
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
    return {
      ...alcanceDelCorte({
        entregaId,
        sesionId: entrega.sesionId,
        finalizadaEn: entrega.finalizadaEn,
        otrasVivas,
      }),
      rechazoDevolucion: entrega.rechazoDevolucion,
    };
  }

  /**
   * Corrige lo declarado mientras Finanzas no haya aceptado el dinero.
   *
   * Es como se arregla un "no coincide": Finanzas no captura otra cifra, asi
   * que si lo que cuenta no es lo declarado, no acepta y el repartidor lo
   * corrige aqui. Una vez aceptado ya no se toca: lo declarado paso a ser el
   * dinero aceptado y dejo su ingreso, y cambiarlo despues borraria el adeudo
   * que justamente hay que cubrir. Lo que falte se abona.
   */
  async corregirDeclarado(
    corteId: string,
    usuario: UsuarioAutenticado,
    dto: CorregirDeclaradoDto,
  ): Promise<CorteDto> {
    await this.prisma.$transaction(async (tx) => {
      // Bloqueado: sin esto, corregir a la vez que Finanzas acepta dejaria
      // aceptada una cifra y escrita otra.
      await tx.$queryRaw`SELECT id FROM cortes WHERE id = ${corteId} FOR UPDATE`;
      const corte = await tx.corte.findUnique({
        where: { id: corteId },
        select: { repartidorId: true, recibidoEn: true },
      });
      if (!corte) throw new NotFoundException('Corte no encontrado');
      CortesService.exigirPropio(corte, usuario);

      if (corte.recibidoEn !== null) {
        throw new ConflictException({
          statusCode: 409,
          code: 'CORTE_RECIBIDO',
          message: 'Finanzas ya aceptó ese dinero: lo declarado ya no se puede cambiar.',
        });
      }

      await tx.corte.update({
        where: { id: corteId },
        data: {
          montoDeclarado: new Decimal(dto.montoDeclarado),
          ...(dto.notas !== undefined && { notas: dto.notas?.trim() || null }),
        },
      });
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
    alcance: Pick<AlcanceConEntrega, 'pedidos' | 'cierraJornada' | 'rechazoDevolucion'>,
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
        // Lo que un cliente a credito abono en la puerta: tambien lo trae el.
        pagos: { where: { enPuerta: true }, select: { monto: true } },
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
    const cuenta = cuentaDelCorte(
      pedidos.map((pedido) => ({ ...pedido, abonoEnPuerta: pagadoDelPedido(pedido) })),
    );
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
      rechazoDevolucion: alcance.rechazoDevolucion,
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
   * Las entregas ya liquidadas del repartidor, de la mas reciente a la mas
   * vieja, con su corte: su estatus, lo que debe (`saldoPendiente`) y el abono
   * que tenga esperando a Finanzas. Mientras el dinero no se acepta todavia se
   * corrige lo declarado; despues, lo que falte se abona. Las vivas no entran: estan
   * en Entregas o en Liquidacion, y repetirlas aqui las ponia en dos pestanas.
   *
   * La segunda rama es la entrega de una jornada cortada entera (cortes de
   * antes): no tiene corte propio, pero tampoco sigue viva.
   */
  async historial(
    usuario: UsuarioAutenticado,
    limite: number,
  ): Promise<{ entregas: EntregaEnHistorialDto[] }> {
    const entregas = await this.prisma.entregaRuta.findMany({
      where: {
        repartidorId: usuario.sub,
        OR: [{ corteId: { not: null } }, { sesion: { corteId: { not: null } } }],
      },
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
        folio: e.folio,
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
   * Lo que salio en una entrega suya y como acabo cada pedido ahi, con el
   * conteo de lo que bajo del camion.
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
    return this.loQueSalio(entregaId);
  }

  /**
   * Los pedidos de una entrega y el conteo por producto. Lo comparten el
   * historial del repartidor y el corte que abre Finanzas, para que los dos
   * lean la misma tabla.
   *
   * Se lee de los renglones del camion y no del pedido: el pedido que regreso
   * ya no apunta a esta entrega. Los pedidos por faltante no tienen renglones
   * —no subieron al camion—, asi que se suman aparte: cuentan como entregados
   * y bajan la devolucion en lo que ya se cobro, igual que al liquidar. Asi
   * "Devolucion" es lo que de verdad tiene que bajar.
   */
  private async loQueSalio(entregaId: string): Promise<DetalleHistorialDto> {
    const [cargas, faltantes] = await Promise.all([
      this.prisma.cargaRepartidor.findMany({
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
              metodoPago: true,
              entregaRutaId: true,
              cliente: { select: { nombre: true } },
            },
          },
        },
      }),
      this.prisma.pedido.findMany({
        where: { entregaRutaId: entregaId, porFaltante: true },
        orderBy: { creadoEn: 'asc' },
        select: {
          id: true,
          folio: true,
          total: true,
          estadoPago: true,
          metodoPago: true,
          cliente: { select: { nombre: true } },
          items: { select: { productoId: true, nombre: true, unidad: true, cantidad: true } },
        },
      }),
    ]);

    const porPedido = new Map<string, typeof cargas>();
    for (const carga of cargas) {
      porPedido.set(carga.pedidoId, [...(porPedido.get(carga.pedidoId) ?? []), carga]);
    }

    const pedidos: PedidoEnHistorialDto[] = [...porPedido.entries()].map(([id, suyas]) => {
      const pedido = suyas[0].pedido;
      const intento = intentoDeEntrega(pedido, entregaId, suyas);
      return {
        id,
        folio: pedido.folio,
        clienteNombre: pedido.cliente.nombre,
        total: pedido.total.toNumber(),
        metodoPago: pedido.metodoPago,
        estadoPago: pedido.estadoPago,
        porFaltante: false,
        resultado: intento.resultado,
        renglones: intento.renglones.map((r, i) => ({
          nombre: suyas[i].pedidoItem.nombre,
          unidad: suyas[i].pedidoItem.unidad,
          ...r,
        })),
      };
    });
    for (const pedido of faltantes) {
      pedidos.push({
        id: pedido.id,
        folio: pedido.folio,
        clienteNombre: pedido.cliente.nombre,
        total: pedido.total.toNumber(),
        metodoPago: pedido.metodoPago,
        estadoPago: pedido.estadoPago,
        porFaltante: true,
        resultado:
          pedido.estadoPago === EstadoPago.CANCELADO
            ? ResultadoDelIntento.CANCELADO
            : ResultadoDelIntento.ENTREGADO,
        renglones: pedido.items.map((item) => ({
          nombre: item.nombre,
          unidad: item.unidad,
          cantidad: item.cantidad,
          recibido: item.cantidad,
          motivo: null,
        })),
      });
    }

    return {
      pedidos,
      conteo: conteoPorProducto([
        ...cargas.map((c) => ({ ...c, nombre: c.pedidoItem.nombre, unidad: c.pedidoItem.unidad })),
        ...faltantes
          .filter((p) => p.estadoPago !== EstadoPago.CANCELADO)
          .flatMap((p) => p.items.map(renglonDelFaltante)),
      ]),
    };
  }

  /**
   * "Entregar dinero" desde el historial del repartidor: lo que trae despues
   * para cubrir lo que quedo debiendo de un corte suyo.
   *
   * Va en una fila aparte en vez de corregir `montoRecibido`: los montos del
   * corte son la fotografia de lo que paso ese dia, y reescribirlos borraria
   * que hubo un adeudo.
   *
   * **Nace pendiente**: no cuenta contra el adeudo ni es un ingreso hasta que
   * Finanzas lo acepta (`aceptarDinero`). Mientras tanto el corte vuelve a
   * LIQUIDADO, que es como Finanzas sabe que tiene algo por aceptar. Por eso
   * solo cabe uno pendiente a la vez —lo cuida tambien un indice unico en la
   * base— y solo despues de "Entrega aceptada": antes no hay adeudo que
   * cubrir, lo declarado todavia se corrige.
   */
  async abonarPropio(
    id: string,
    dto: RegistrarAbonoDto,
    usuario: UsuarioAutenticado,
  ): Promise<CorteDto> {
    await this.prisma.$transaction(async (tx) => {
      // Bloqueado: dos abonos a la vez leerian el mismo adeudo y juntos lo pasarian.
      await tx.$queryRaw`SELECT id FROM cortes WHERE id = ${id} FOR UPDATE`;
      const corte = await tx.corte.findUnique({
        where: { id },
        include: { abonos: { select: { monto: true, aceptadoEn: true } } },
      });
      if (!corte) throw new NotFoundException('Corte no encontrado');
      CortesService.exigirPropio(corte, usuario);

      if (abonoPendiente(corte.abonos)) {
        throw new ConflictException({
          statusCode: 409,
          code: 'ABONO_PENDIENTE',
          message:
            'Ya tienes un abono esperando a que Finanzas lo acepte. ' +
            'Si te equivocaste, cancélalo y regístralo de nuevo.',
        });
      }
      if (corte.entregaAceptadaEn === null) {
        throw new ConflictException({
          statusCode: 409,
          code: 'ENTREGA_SIN_ACEPTAR',
          message: 'Finanzas todavía no acepta esa entrega: aún no hay adeudo que cubrir.',
        });
      }

      // Un abono salda lo que falta, no crea saldo a favor: lo que sobre es
      // otro asunto y no tiene donde quedar escrito.
      const adeudo = adeudoDelCorte(corte);
      const monto = new Decimal(dto.monto);
      if (monto.gt(adeudo.add(TOLERANCIA))) {
        throw new ConflictException({
          statusCode: 409,
          code: 'ABONO_EXCEDE_FALTANTE',
          message: adeudo.isZero()
            ? 'Ese corte ya está saldado: no hay nada que abonar.'
            : `El abono pasa de lo que falta: quedan $${adeudo.toFixed(2)}.`,
        });
      }

      await tx.corteAbono.create({
        data: {
          corteId: id,
          monto,
          registradoPorId: usuario.sub,
          nota: dto.nota?.trim() || null,
        },
      });
      await tx.corte.update({
        where: { id },
        data: {
          estado: estadoTrasAceptar({
            ...corte,
            abonos: [...corte.abonos, { monto, aceptadoEn: null }],
          }),
        },
      });
    });
    return this.detalle(id);
  }

  /**
   * El repartidor cancela su abono pendiente: se equivoco de monto, o ese
   * dinero no llego a Finanzas. El abono se borra —nunca conto para nada— y el
   * corte vuelve al estatus que tenia sin el.
   *
   * Solo mientras este pendiente. Uno aceptado ya es un ingreso en el libro, y
   * el libro no se edita.
   */
  async cancelarAbono(id: string, abonoId: string, usuario: UsuarioAutenticado): Promise<CorteDto> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM cortes WHERE id = ${id} FOR UPDATE`;
      const corte = await tx.corte.findUnique({
        where: { id },
        include: { abonos: { select: { id: true, monto: true, aceptadoEn: true } } },
      });
      if (!corte) throw new NotFoundException('Corte no encontrado');
      CortesService.exigirPropio(corte, usuario);

      const abono = corte.abonos.find((a) => a.id === abonoId);
      if (!abono) throw new NotFoundException('Abono no encontrado');
      if (abono.aceptadoEn !== null) {
        throw new ConflictException({
          statusCode: 409,
          code: 'ABONO_YA_ACEPTADO',
          message: 'Finanzas ya aceptó ese abono: ya no se puede cancelar.',
        });
      }

      await tx.corteAbono.delete({ where: { id: abonoId } });
      await tx.corte.update({
        where: { id },
        data: {
          estado: estadoTrasAceptar({
            ...corte,
            abonos: corte.abonos.filter((a) => a.id !== abonoId),
          }),
        },
      });
    });
    return this.detalle(id);
  }

  /** El corte es de quien pregunta: nadie abona ni corrige el de otro. */
  private static exigirPropio(corte: { repartidorId: string }, usuario: UsuarioAutenticado): void {
    if (corte.repartidorId !== usuario.sub) {
      throw new ConflictException({
        statusCode: 409,
        code: 'CORTE_DE_OTRO',
        message: 'Ese corte es de otro repartidor.',
      });
    }
  }

  /**
   * Baja del camion lo que queda de la entrega: escribe lo devuelto en cada
   * renglon, lo cierra, devuelve al fisico todo lo que baja, libera para venta
   * lo rechazado en la puerta y devuelve a la cola los pedidos que no se
   * llegaron a entregar. Lo llama `aceptarDevolucion()`, no la liquidacion.
   */
  private async descargarCamion(
    tx: Prisma.TransactionClient,
    donde: Prisma.CargaRepartidorWhereInput,
    quien: ActorDeBitacora,
    controlInventario: boolean,
    /** Lo ya cobrado como faltante: no bajo del camion, asi que ni vuelve al fisico ni se libera. */
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

    // Todo lo que seguia arriba deja de ir en ruta, haya vuelto a bodega o se
    // haya cobrado como faltante: el saldo en ruta cuenta renglones abiertos y
    // aqui se cierran todos. No depende de `controlInventario`.
    await this.inventario.bajarDeRuta(
      tx,
      cargas.map((c) => ({
        productoId: c.productoId,
        cantidad: c.cantidadCargada - c.cantidadEntregada,
      })),
    );

    for (const pedido of plan.pedidos) {
      // Primero al estante, luego a venta: lo rechazado vuelve a los dos
      // saldos; el pedido que regresa entero, solo al fisico.
      if (pedido.alFisico.length > 0) {
        await this.inventario.registrarRegresoDeRuta(
          tx,
          pedido.pedidoId,
          pedido.folio,
          pedido.alFisico,
          { usuarioId: quien.actorId, usuarioNombre: quien.actorNombre },
        );
      }
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
            nota: 'Regresó a bodega al aceptarse la devolución: vuelve a salir otro día.',
          },
          quien,
        );
      }
    }
  }

  // ----------------------------------------------------------------
  // Finanzas
  // ----------------------------------------------------------------

  /**
   * "Aceptar devolucion": Finanzas vio la mercancia que regreso y aqui baja
   * del camion. Se acepta antes o despues que el dinero, segun llegue primero;
   * los dos van antes de "Entrega aceptada".
   *
   * En una transaccion, con el corte y su jornada bloqueados:
   *
   *  1. **Se descarga su parte del camion** (`descargarCamion`): cada renglon
   *     abierto escribe lo que devuelve y se cierra. Todo lo que baja vuelve
   *     al fisico, del que salio al recolectarse; lo que un cliente rechazo
   *     vuelve ademas a estar disponible para venta, y lo cobrado como
   *     faltante no vuelve a ningun sitio.
   *  2. Lo que no se entrego regresa a "Listo para entrega" y suelta a su
   *     repartidor, para que pueda salir en otra entrega.
   *  3. El corte queda con su devolucion aceptada, y por quien.
   *  4. Si ya no queda otra entrega viva en la jornada —sin liquidar, o
   *     liquidada con la devolucion pendiente—, la jornada se cierra atada a
   *     este corte: el camion quedo vacio.
   *
   * **Quien acepta no puede ser quien liquido**, salvo el administrador: el
   * que trae la mercancia no se la cuenta a si mismo.
   */
  async aceptarDevolucion(id: string, usuario: UsuarioAutenticado): Promise<CorteDto> {
    const quien = actorDe(usuario);
    const controlInventario = (await this.configuracion.obtener()).controlInventario;

    await this.prisma.$transaction(async (tx) => {
      // Bloqueado: dos pulsaciones a la vez descargarian el camion dos veces.
      await tx.$queryRaw`SELECT id FROM cortes WHERE id = ${id} FOR UPDATE`;
      const corte = await tx.corte.findUnique({
        where: { id },
        select: {
          repartidorId: true,
          devolucionAceptadaEn: true,
          entregas: { select: { id: true, sesionId: true }, take: 1 },
        },
      });
      if (!corte) throw new NotFoundException('Corte no encontrado');

      if (corte.devolucionAceptadaEn !== null) {
        throw new ConflictException({
          statusCode: 409,
          code: 'DEVOLUCION_YA_ACEPTADA',
          message: 'La devolución de ese corte ya se aceptó.',
        });
      }
      CortesService.exigirOtraPersona(corte, usuario);

      // Todo corte con la devolucion pendiente nacio de una entrega: los de
      // jornada entera son de antes y su devolucion quedo aceptada al migrar.
      const entrega = corte.entregas[0];
      if (!entrega) throw new NotFoundException('Ese corte no tiene entrega que descargar');

      // La jornada tambien: dos devoluciones de entregas distintas a la vez
      // podrian creer cada una que queda la otra, y la jornada no se cerraria.
      await tx.$queryRaw`SELECT id FROM sesiones_entrega WHERE id = ${entrega.sesionId} FOR UPDATE`;
      const otrasVivas = await tx.entregaRuta.count({
        where: {
          sesionId: entrega.sesionId,
          id: { not: entrega.id },
          OR: [{ corteId: null }, { corte: { devolucionAceptadaEn: null } }],
        },
      });
      const alcance = alcanceDeLaDescarga({
        entregaId: entrega.id,
        sesionId: entrega.sesionId,
        otrasVivas,
      });

      // Lo cobrado como faltante en este corte, por producto: no bajo del
      // camion, asi que ni vuelve al fisico ni se libera.
      const itemsFaltantes = await tx.pedidoItem.findMany({
        where: { pedido: { corteId: id, porFaltante: true } },
        select: { productoId: true, cantidad: true },
      });
      const faltantes = new Map<string, number>();
      for (const item of itemsFaltantes) {
        faltantes.set(item.productoId, (faltantes.get(item.productoId) ?? 0) + item.cantidad);
      }

      await this.descargarCamion(tx, alcance.cargas, quien, controlInventario, faltantes);

      const ahora = new Date();
      await tx.corte.update({
        where: { id },
        data: { devolucionAceptadaEn: ahora, devolucionAceptadaPorId: usuario.sub },
      });

      // La ultima entrega se lleva la jornada: atada a su corte, ya no es "la viva".
      if (alcance.cierraJornada) {
        const jornada = await tx.sesionEntrega.findUniqueOrThrow({
          where: { id: entrega.sesionId },
        });
        await tx.sesionEntrega.update({
          where: { id: jornada.id },
          data: { corteId: id, finalizadaEn: jornada.finalizadaEn ?? ahora },
        });
      }

      this.logger.log(
        `Devolución del corte ${id} aceptada por ${usuario.nombre}` +
          (alcance.cierraJornada ? ': cierra la jornada' : ''),
      );
    });

    return this.detalle(id);
  }

  /**
   * "Entrega aceptada": con la devolucion y el dinero ya aceptados, Finanzas
   * da por buena la entrega entera. Es lo que cierra el dinero de sus pedidos:
   *
   *  1. Los pedidos **en efectivo** que entrego quedan pagados y ganan su
   *     cashback (`FinanzasService.marcarPagado`), incluidos los de faltante.
   *     El cliente ya pago; si el repartidor entrego de menos, eso es adeudo
   *     suyo y no frena a sus clientes.
   *  2. Los entregados **a credito** que deben algo pasan a cuenta por cobrar
   *     (`cxcDesde`).
   *  3. El corte queda **cerrado** si el repartidor no debe nada, o
   *     **aceptado** si debe (`estadoTrasAceptar`). De ahi en adelante el
   *     estatus cambia solo, con cada abono que se le acepte.
   *
   * Se pulsa una sola vez por corte. **Quien acepta no puede ser quien
   * liquido**, salvo el administrador.
   */
  async aceptarEntrega(id: string, usuario: UsuarioAutenticado): Promise<CorteDto> {
    const quien = actorDe(usuario);

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM cortes WHERE id = ${id} FOR UPDATE`;
      const corte = await tx.corte.findUnique({
        where: { id },
        include: {
          abonos: { select: { monto: true, aceptadoEn: true } },
          entregas: { select: { folio: true }, take: 1 },
        },
      });
      if (!corte) throw new NotFoundException('Corte no encontrado');

      if (corte.entregaAceptadaEn !== null) {
        throw new ConflictException({
          statusCode: 409,
          code: 'ENTREGA_YA_ACEPTADA',
          message: 'Esa entrega ya se aceptó.',
        });
      }
      if (corte.devolucionAceptadaEn === null) {
        throw new ConflictException({
          statusCode: 409,
          code: 'DEVOLUCION_SIN_ACEPTAR',
          message: 'Acepta primero la devolución de esa entrega.',
        });
      }
      if (corte.recibidoEn === null) {
        throw new ConflictException({
          statusCode: 409,
          code: 'DINERO_SIN_ACEPTAR',
          message: 'Acepta primero el dinero de esa entrega.',
        });
      }
      CortesService.exigirOtraPersona(corte, usuario);

      const pedidos = await tx.pedido.findMany({
        where: { corteId: id, estado: EstadoPedido.ENTREGADO },
        select: {
          id: true,
          metodoPago: true,
          estadoPago: true,
          total: true,
          pagadoConBilletera: true,
          cxcDesde: true,
          pagos: { where: { enPuerta: true }, select: { monto: true } },
        },
        orderBy: { creadoEn: 'asc' },
      });

      const ahora = new Date();
      const reparto = corte.entregas[0]?.folio;
      const nota = reparto ? `Entrega ${reparto} aceptada.` : 'Entrega aceptada.';
      let pagados = 0;
      let aCxc = 0;
      for (const pedido of pedidos) {
        const destino = destinoAlAceptar({ ...pedido, abonoEnPuerta: pagadoDelPedido(pedido) });
        if (destino === DestinoDelPedido.PAGADO) {
          if (await this.finanzas.marcarPagado(tx, pedido.id, quien, nota)) pagados++;
        } else if (destino === DestinoDelPedido.CXC && pedido.cxcDesde === null) {
          await tx.pedido.update({ where: { id: pedido.id }, data: { cxcDesde: ahora } });
          aCxc++;
        }
      }

      const estado = estadoTrasAceptar({
        montoCalculado: corte.montoCalculado,
        montoRecibido: corte.montoRecibido,
        entregaAceptadaEn: ahora,
        abonos: corte.abonos,
      });
      await tx.corte.update({
        where: { id },
        data: { entregaAceptadaEn: ahora, entregaAceptadaPorId: usuario.sub, estado },
      });

      this.logger.log(
        `Entrega del corte ${id} aceptada por ${usuario.nombre}: ${pagados} pedido(s) ` +
          `pagado(s), ${aCxc} a CXC, queda ${estado}`,
      );
    });

    return this.detalle(id);
  }

  /**
   * "Rechazar devolucion": lo que regreso no es lo que el repartidor conto, y
   * la liquidacion **se deshace entera**.
   *
   * Como liquidar no descargo el camion, deshacer es soltar lo que el corte
   * ato y borrarlo; no hay inventario que desandar:
   *
   *  1. Los pedidos del corte dejan de estar liquidados y lo sueltan.
   *  2. La entrega lo suelta y se queda con el motivo, que es lo que el
   *     repartidor lee para saber que recontar. Sigue finalizada: vuelve a la
   *     pestana de Liquidacion, y desde ahi puede reanudarla si hace falta.
   *  3. El corte se borra.
   *
   * Los pedidos por faltante que genero se conservan: son ventas entregadas en
   * esa entrega y entraran al corte siguiente.
   *
   * Solo antes de aceptar la devolucion y antes de aceptar el dinero: nunca se
   * deshace una liquidacion con un ingreso (la base tampoco dejaria borrar el
   * corte, `Ingreso.corte` es `Restrict`).
   */
  async rechazarDevolucion(
    id: string,
    dto: RechazarDevolucionDto,
    usuario: UsuarioAutenticado,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM cortes WHERE id = ${id} FOR UPDATE`;
      const corte = await tx.corte.findUnique({
        where: { id },
        select: {
          devolucionAceptadaEn: true,
          recibidoEn: true,
          entregas: { select: { id: true } },
        },
      });
      if (!corte) throw new NotFoundException('Corte no encontrado');

      if (corte.devolucionAceptadaEn !== null) {
        throw new ConflictException({
          statusCode: 409,
          code: 'DEVOLUCION_YA_ACEPTADA',
          message: 'La devolución de ese corte ya se aceptó: ya no se puede rechazar.',
        });
      }
      if (corte.recibidoEn !== null) {
        throw new ConflictException({
          statusCode: 409,
          code: 'DINERO_YA_ACEPTADO',
          message:
            'El dinero de ese corte ya se aceptó y está en Ingresos: la devolución ya no se puede rechazar.',
        });
      }

      await tx.pedido.updateMany({
        where: { corteId: id },
        data: { liquidado: false, liquidadoEn: null, corteId: null },
      });
      await tx.entregaRuta.updateMany({
        where: { corteId: id },
        data: { corteId: null, rechazoDevolucion: dto.motivo, rechazoDevolucionEn: new Date() },
      });
      await tx.corte.delete({ where: { id } });

      this.logger.log(
        `Devolución del corte ${id} rechazada por ${usuario.nombre}: "${dto.motivo}". ` +
          `Liquidación deshecha (${corte.entregas.length} entrega(s))`,
      );
    });
  }

  /**
   * Quien acepta algo de un corte no puede ser quien lo liquido, salvo el
   * administrador: el que trae el dinero y la mercancia no se los cuenta a si
   * mismo, pero un negocio con un solo usuario (el administrador, que reparte
   * y cuenta) no podria aceptar nunca un corte. La regla depende del rol, asi
   * que vive aqui y no en la base (migracion `admin_recibe_su_corte`).
   */
  private static exigirOtraPersona(
    corte: { repartidorId: string },
    usuario: UsuarioAutenticado,
  ): void {
    if (corte.repartidorId === usuario.sub && usuario.rol !== RolUsuario.ADMINISTRADOR) {
      throw new ConflictException({
        statusCode: 409,
        code: 'RECIBE_EL_MISMO',
        message: 'No puedes aceptar tu propio corte: tiene que revisarlo alguien más.',
      });
    }
  }

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
   * El corte abierto en Finanzas: ademas de sus cifras, lo que salio en su
   * entrega y lo que baja del camion por producto. Es contra lo que se revisa
   * la mercancia antes de aceptar la devolucion.
   *
   * Un corte de jornada entera, de antes, no tiene entrega propia: va sin
   * pedidos ni conteo, y su devolucion ya esta aceptada.
   */
  async detalleParaFinanzas(id: string): Promise<DetalleCorteDto> {
    const corte = await this.detalle(id);
    const salio = corte.entrega
      ? await this.loQueSalio(corte.entrega.id)
      : { pedidos: [], conteo: [] };
    return { corte, ...salio };
  }

  /**
   * "Aceptar dinero": Finanzas conto lo que el repartidor trae y es lo que
   * dijo. No captura otra cifra: acepta la que esta escrita. Si no coincide
   * con lo que tiene en la mano, no acepta y el repartidor la corrige.
   *
   * Sirve para los dos dineros de un corte, y acepta el que este pendiente:
   *
   *  - **El de la liquidacion**, la primera vez: lo declarado pasa a ser el
   *    dinero aceptado (`montoRecibido`), y de ahi sale lo que el repartidor
   *    queda debiendo.
   *  - **Un abono**, despues: el que el repartidor registro para cubrir su
   *    adeudo deja de estar pendiente y empieza a contar.
   *
   * Cada uno deja su renglon en el libro de ingresos, en la misma transaccion,
   * y el estatus del corte se vuelve a deducir (`estadoTrasAceptar`): un abono
   * que salda el adeudo lo cierra sin mas pasos.
   *
   * No espera a la devolucion: la mercancia y el dinero llegan al mostrador en
   * momentos distintos y se aceptan en el orden en que lleguen. Lo que si
   * cambia es que, con el dinero aceptado, la devolucion ya no se puede
   * rechazar (`rechazarDevolucion`): nunca se deshace una liquidacion con un
   * ingreso. **Quien acepta no puede ser quien liquido**, salvo el
   * administrador.
   */
  async aceptarDinero(id: string, usuario: UsuarioAutenticado): Promise<CorteDto> {
    await this.prisma.$transaction(async (tx) => {
      // Bloqueado: dos pulsaciones a la vez aceptarian el mismo dinero dos veces.
      await tx.$queryRaw`SELECT id FROM cortes WHERE id = ${id} FOR UPDATE`;
      const corte = await tx.corte.findUnique({
        where: { id },
        include: {
          abonos: { orderBy: { creadoEn: 'asc' } },
          entregas: { select: { folio: true }, take: 1 },
        },
      });
      if (!corte) throw new NotFoundException('Corte no encontrado');

      CortesService.exigirOtraPersona(corte, usuario);

      const ahora = new Date();
      // Los cortes de jornada entera, de antes, no tienen entrega ni folio.
      const referencia = corte.entregas[0]?.folio ?? 'S/F';
      let montoRecibido = corte.montoRecibido;
      let abonos = corte.abonos;
      let aceptado: Prisma.Decimal;

      if (corte.recibidoEn === null) {
        aceptado = corte.montoDeclarado;
        montoRecibido = corte.montoDeclarado;
        await this.ingresos.registrar(tx, {
          concepto: ConceptoIngreso.ENTREGA,
          referencia,
          monto: aceptado,
          metodo: MetodoPago.EFECTIVO,
          registradoPorId: usuario.sub,
          corteId: id,
        });
      } else {
        const pendiente = abonoPendiente(corte.abonos);
        if (!pendiente) {
          throw new ConflictException({
            statusCode: 409,
            code: 'SIN_DINERO_POR_ACEPTAR',
            message: 'Ese corte no tiene dinero por aceptar.',
          });
        }
        aceptado = pendiente.monto;
        await tx.corteAbono.update({
          where: { id: pendiente.id },
          data: { aceptadoEn: ahora, aceptadoPorId: usuario.sub },
        });
        abonos = corte.abonos.map((a) => (a.id === pendiente.id ? { ...a, aceptadoEn: ahora } : a));
        await this.ingresos.registrar(tx, {
          concepto: ConceptoIngreso.ENTREGA,
          referencia,
          monto: aceptado,
          metodo: MetodoPago.EFECTIVO,
          nota: pendiente.nota,
          registradoPorId: usuario.sub,
          corteId: id,
          corteAbonoId: pendiente.id,
        });
      }

      await tx.corte.update({
        where: { id },
        data: {
          ...(corte.recibidoEn === null && {
            montoRecibido,
            recibidoEn: ahora,
            recibidoPorId: usuario.sub,
          }),
          estado: estadoTrasAceptar({
            montoCalculado: corte.montoCalculado,
            montoRecibido,
            entregaAceptadaEn: corte.entregaAceptadaEn,
            abonos,
          }),
        },
      });

      this.logger.log(
        `Dinero del corte ${id} aceptado por ${usuario.nombre}: $${aceptado.toFixed(2)} ` +
          `(${corte.recibidoEn === null ? 'liquidación' : 'abono'}) de ` +
          `$${corte.montoCalculado.toFixed(2)} calculados`,
      );
    });

    return this.detalle(id);
  }

  /**
   * El corte como lo lee una pantalla.
   *
   * `diferencia` compara lo declarado con lo calculado —lo que el repartidor
   * creia traer frente a lo que el sistema dice— y `saldoPendiente` lo que
   * debe de verdad: lo calculado menos el dinero aceptado y los abonos
   * aceptados. Hasta que Finanzas acepta el dinero, no hay adeudo que reclamar.
   */
  private static aDto(corte: CorteCompleto): CorteDto {
    const pendiente = adeudoDelCorte(corte);
    const porAceptar =
      corte.recibidoEn === null ? corte.montoDeclarado : abonoPendiente(corte.abonos)?.monto;

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
      devolucionAceptadaEn: corte.devolucionAceptadaEn?.toISOString() ?? null,
      devolucionAceptadaPorNombre: corte.devolucionAceptadaPor?.nombre ?? null,
      entregaAceptadaEn: corte.entregaAceptadaEn?.toISOString() ?? null,
      entregaAceptadaPorNombre: corte.entregaAceptadaPor?.nombre ?? null,
      dineroPorAceptar: porAceptar?.toNumber() ?? null,
      estado: corte.estado,
      notas: corte.notas,
      entrega: corte.entregas[0] ?? null,
      abonos: corte.abonos.map((a) => ({
        id: a.id,
        monto: a.monto.toNumber(),
        registradoPorNombre: a.registradoPor.nombre,
        nota: a.nota,
        creadoEn: a.creadoEn.toISOString(),
        aceptadoEn: a.aceptadoEn?.toISOString() ?? null,
      })),
      pedidos: corte._count.pedidos,
    };
  }
}
