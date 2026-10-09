import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ConceptoIngreso,
  EstadoCorte,
  EstadoPago,
  EstadoPedido,
  MetodoEntrega,
  MetodoPago,
  Prisma,
  RolUsuario,
  TurnoPdv,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import {
  CatalogoRecomendadoDto,
  FamiliaRecomendadaDto,
  ProductoRecomendadoDto,
  RecomendacionesService,
} from '../catalogo/recomendaciones.service';
import { actorDe } from '../pedidos/bitacora';
import { CarritoService, PrevisualizacionCarritoDto } from '../pedidos/carrito.service';
import { DireccionEntregaDto } from '../pedidos/dto/carrito.dto';
import { FinanzasService } from '../pedidos/finanzas.service';
import { FlujoPedidosService } from '../pedidos/flujo-pedidos.service';
import { IngresosService } from '../ingresos/ingresos.service';
import { FiltroCortes } from '../rutas/cortes.service';
import { RegistrarAbonoDto } from '../rutas/dto/corte.dto';
import {
  abonoPendiente,
  adeudoDelCorte,
  CorteEnCuenta,
  estadoTrasAceptar,
  TOLERANCIA,
} from '../rutas/estado-del-corte';
import { PedidoDto, PedidosService, UltimoPedidoDto } from '../pedidos/pedidos.service';
import { TiendasService } from '../tiendas/tiendas.service';
import { PedidoDelTurno, productosEntregados, totalesDelTurno } from './corte-de-caja';
import {
  AbrirTurnoDto,
  CorteDeCajaDto,
  CrearPedidoPdvDto,
  PrevisualizarPdvDto,
  RegistrarClienteDto,
} from './dto/pdv.dto';

const Decimal = Prisma.Decimal;

/** El cliente tal como lo necesita el mostrador. */
export interface ClientePdvDto {
  id: string;
  nombre: string;
  telefono: string;
  /** Todavia no ha comprado: es un prospecto, y este pedido lo convierte. */
  esNuevo: boolean;
  saldoBilletera: number;
  /** La direccion de su perfil en una linea, o `null` si no esta completa. */
  direccion: string | null;
}

export interface TurnoDto {
  id: string;
  folio: string;
  tienda: { id: string; nombre: string };
  cajero: string;
  abiertoEn: string;
  /** `null` mientras el turno sigue abierto. */
  cerradoEn: string | null;
  totales: {
    pedidos: number;
    cobrados: number;
    porEntregar: number;
    aDomicilio: number;
    cancelados: number;
    ventas: number;
    efectivo: number;
    transferencia: number;
    billetera: number;
  };
  /** Lo que el cajero conto en el corte. */
  efectivoDeclarado: number | null;
  /** Declarado menos calculado: negativo es faltante. */
  diferencia: number | null;
  notas: string | null;
  /** En que va el corte en Finanzas. `null` mientras el turno sigue abierto. */
  corte: CorteDeTurnoDto | null;
}

/** El corte de caja visto desde Finanzas: lo aceptado, lo que falta y sus abonos. */
export interface CorteDeTurnoDto {
  estado: EstadoCorte;
  /** El dinero aceptado al revisar el corte. `null` mientras Finanzas no lo acepte. */
  efectivoRecibido: number | null;
  recibidoEn: string | null;
  recibidoPorNombre: string | null;
  /**
   * El adeudo del cajero: lo calculado menos el dinero aceptado y los abonos
   * aceptados. Cero mientras Finanzas no acepte el dinero.
   */
  saldoPendiente: number;
  /**
   * Lo que "Aceptar dinero" aceptaria ahora: lo declarado si el corte sigue
   * sin aceptar, el abono pendiente si lo hay, o `null` si no hay dinero
   * esperando.
   */
  dineroPorAceptar: number | null;
  abonos: {
    id: string;
    monto: number;
    registradoPorNombre: string;
    nota: string | null;
    creadoEn: string;
    /** `null` mientras Finanzas no lo acepte: aun no cuenta contra el adeudo. */
    aceptadoEn: string | null;
  }[];
}

/** Los cortes de caja de una pestana de Finanzas, con cuantos hay en cada una. */
export interface ListadoCortesDeCajaDto {
  turnos: TurnoDto[];
  conteos: Record<FiltroCortes, number>;
}

/** Las mismas pestanas que los cortes de ruta: una por estatus. */
const WHERE_CORTES_DE_CAJA: Record<FiltroCortes, Prisma.TurnoPdvWhereInput> = {
  [FiltroCortes.POR_ACEPTAR]: { estadoCorte: EstadoCorte.LIQUIDADO },
  [FiltroCortes.CON_ADEUDO]: { estadoCorte: EstadoCorte.ACEPTADO },
  [FiltroCortes.CERRADOS]: { estadoCorte: EstadoCorte.CERRADO },
};

/** El catalogo de la Tienda con lo que esa tienda puede vender de cada producto. */
export type CatalogoPdvDto = Omit<CatalogoRecomendadoDto, 'familias'> & {
  familias: (Omit<FamiliaRecomendadaDto, 'productos'> & {
    /** `agotado` ya dice si la tienda no lo tiene; `enTienda` es el tope de piezas. */
    productos: (ProductoRecomendadoDto & { enTienda: number })[];
  })[];
};

/** Un producto con todo lo que el turno entrego de el en el mostrador. */
export interface ProductoEntregadoDto {
  productoId: string;
  nombre: string;
  unidad: string;
  cantidad: number;
  importe: number;
}

export type TurnoConPedidosDto = TurnoDto & {
  pedidos: PedidoDto[];
  /** Lo que salio de la tienda, sumado por producto. */
  productosEntregados: ProductoEntregadoDto[];
};

const INCLUIR_TURNO = {
  tienda: { select: { id: true, nombre: true } },
  pedidos: {
    select: {
      estado: true,
      estadoPago: true,
      metodoPago: true,
      metodoEntrega: true,
      total: true,
      pagadoConBilletera: true,
    },
  },
  abonos: { orderBy: { creadoEn: 'asc' } },
} satisfies Prisma.TurnoPdvInclude;

type TurnoCompleto = Prisma.TurnoPdvGetPayload<{ include: typeof INCLUIR_TURNO }>;

/** Los campos del perfil de los que sale la direccion de un envio. */
const CAMPOS_DIRECCION = {
  id: true,
  nombre: true,
  telefono: true,
  quienRecibe: true,
  calle: true,
  colonia: true,
  cp: true,
  ciudad: true,
  estado: true,
  referencias: true,
  lat: true,
  lng: true,
} as const;

type PerfilConDireccion = Prisma.ProspectoGetPayload<{ select: typeof CAMPOS_DIRECCION }>;

const LIMITE_TURNOS = 60;
/** Cuantos telefonos se proponen mientras el cajero teclea. */
const LIMITE_SUGERENCIAS = 6;
const LIMITE_PEDIDOS = 500;

/**
 * El punto de venta: turnos de caja, y los pedidos que se capturan, se
 * entregan y se cobran en el mostrador.
 *
 * No repite nada del checkout. El carrito se valora con `CarritoService` y el
 * pedido lo crea `PedidosService.crear`, los mismos que usa la app: aqui solo
 * se decide para que cliente, en que turno y quien lo firma.
 */
@Injectable()
export class PdvService {
  private readonly logger = new Logger(PdvService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pedidos: PedidosService,
    private readonly carrito: CarritoService,
    private readonly finanzas: FinanzasService,
    private readonly recomendaciones: RecomendacionesService,
    private readonly tiendas: TiendasService,
    private readonly configuracion: ConfiguracionService,
    private readonly ingresos: IngresosService,
  ) {}

  // ----------------------------------------------------------------
  // Turnos
  // ----------------------------------------------------------------

  /** El turno abierto de quien pregunta en esa tienda, con sus pedidos, o `null`. */
  async turnoAbierto(
    tiendaId: string,
    usuario: UsuarioAutenticado,
  ): Promise<TurnoConPedidosDto | null> {
    const turno = await this.prisma.turnoPdv.findFirst({
      where: { tiendaId, cajeroId: usuario.sub, cerradoEn: null },
      include: INCLUIR_TURNO,
    });
    return turno ? this.conPedidos(turno) : null;
  }

  /**
   * "Crear turno". Tener ya uno abierto en esa tienda es 409 `TURNO_ABIERTO`;
   * el indice parcial `turnos_pdv_uno_abierto_por_tienda` es quien de verdad
   * lo impide, y su P2002 se traduce al mismo codigo. En otra tienda si puede
   * abrir: cada tienda lleva su caja.
   */
  async abrir(dto: AbrirTurnoDto, usuario: UsuarioAutenticado): Promise<TurnoConPedidosDto> {
    const tienda = await this.tiendas.exigir(dto.tiendaId);
    if (!tienda.activa) {
      throw new ConflictException({
        statusCode: 409,
        code: 'TIENDA_INACTIVA',
        message: `La tienda «${tienda.nombre}» está desactivada.`,
      });
    }

    try {
      const turno = await this.prisma.$transaction(async (tx) =>
        tx.turnoPdv.create({
          data: {
            folio: await PdvService.siguienteFolio(tx),
            tiendaId: tienda.id,
            cajeroId: usuario.sub,
            cajeroNombre: usuario.nombre,
          },
          include: INCLUIR_TURNO,
        }),
      );
      this.logger.log(`Turno ${turno.folio} abierto en ${tienda.nombre} por ${usuario.nombre}`);
      return { ...PdvService.aDto(turno), pedidos: [], productosEntregados: [] };
    } catch (fallo) {
      if (fallo instanceof Prisma.PrismaClientKnownRequestError && fallo.code === 'P2002') {
        throw new ConflictException({
          statusCode: 409,
          code: 'TURNO_ABIERTO',
          message:
            'Ya tienes un turno abierto en esta tienda: haz su corte de caja antes de crear otro.',
        });
      }
      throw fallo;
    }
  }

  /**
   * Corte de caja: los turnos de esa tienda, del mas reciente al mas viejo. El
   * cajero ve los suyos; el administrador, los de todos.
   */
  async listar(tiendaId: string, usuario: UsuarioAutenticado): Promise<TurnoDto[]> {
    const turnos = await this.prisma.turnoPdv.findMany({
      where: { tiendaId, ...(!PdvService.esAdmin(usuario) && { cajeroId: usuario.sub }) },
      include: INCLUIR_TURNO,
      orderBy: { abiertoEn: 'desc' },
      take: LIMITE_TURNOS,
    });
    return turnos.map((t) => PdvService.aDto(t));
  }

  async detalle(id: string, usuario: UsuarioAutenticado): Promise<TurnoConPedidosDto> {
    const turno = await this.prisma.turnoPdv.findUnique({ where: { id }, include: INCLUIR_TURNO });
    if (!turno) throw new NotFoundException('Turno no encontrado');
    PdvService.exigirPropio(turno, usuario);
    return this.conPedidos(turno);
  }

  /**
   * El corte de caja: cierra el turno y congela lo que el sistema dice que hay
   * en efectivo junto a lo que el cajero conto.
   *
   * No se cierra con pedidos para llevar sin entregar (409
   * `TURNO_CON_PENDIENTES`): su dinero no esta ni cobrado ni descartado, y el
   * corte saldria con una cifra que cambiaria despues.
   *
   * Nace LIQUIDADO: desde aqui lo ve Finanzas en "Por aceptar", y hasta que lo
   * acepta ese efectivo no esta en Ingresos.
   */
  async cerrar(
    id: string,
    dto: CorteDeCajaDto,
    usuario: UsuarioAutenticado,
  ): Promise<TurnoConPedidosDto> {
    const cerrado = await this.prisma.$transaction(async (tx) => {
      // Bloqueada: un pedido no puede entregarse a medio corte, ni al reves.
      const turno = await PdvService.bloquearAbierto(tx, id, usuario);
      const totales = totalesDelTurno(turno.pedidos);
      if (totales.porEntregar > 0) {
        throw new ConflictException({
          statusCode: 409,
          code: 'TURNO_CON_PENDIENTES',
          message: `Hay ${totales.porEntregar} pedido(s) sin entregar: entrégalos o pide a Finanzas que los cancele antes del corte.`,
        });
      }
      return tx.turnoPdv.update({
        where: { id },
        data: {
          cerradoEn: new Date(),
          efectivoCalculado: totales.efectivo,
          efectivoDeclarado: new Decimal(dto.efectivoDeclarado),
          notas: dto.notas?.trim() || null,
          estadoCorte: EstadoCorte.LIQUIDADO,
        },
        include: INCLUIR_TURNO,
      });
    });
    this.logger.log(`Corte de caja del turno ${cerrado.folio} por ${usuario.nombre}`);
    return this.conPedidos(cerrado);
  }

  // ----------------------------------------------------------------
  // El dinero del corte, despues de hecho
  // ----------------------------------------------------------------

  /**
   * "Corregir lo que declare": el cajero conto mal, o aparecio el billete que
   * faltaba. Pisa lo declarado; solo mientras Finanzas no lo acepte (409
   * `DINERO_YA_ACEPTADO`): aceptado ya es un ingreso, y lo que falte se cubre
   * con abonos.
   */
  async corregirDeclarado(
    id: string,
    dto: CorteDeCajaDto,
    usuario: UsuarioAutenticado,
  ): Promise<TurnoDto> {
    await this.prisma.$transaction(async (tx) => {
      const turno = await PdvService.bloquearCortado(tx, id);
      PdvService.exigirPropio(turno, usuario);
      if (turno.recibidoEn !== null) {
        throw PdvService.conflicto(
          'DINERO_YA_ACEPTADO',
          'Finanzas ya aceptó ese dinero: lo que falte se entrega como abono.',
        );
      }
      await tx.turnoPdv.update({
        where: { id },
        data: {
          efectivoDeclarado: new Decimal(dto.efectivoDeclarado),
          ...(dto.notas !== undefined && { notas: dto.notas.trim() || null }),
        },
      });
    });
    return this.dtoDe(id);
  }

  /**
   * El cajero entrega mas dinero contra el adeudo de su corte. Como el abono
   * del repartidor: nace pendiente, no baja el adeudo hasta que Finanzas lo
   * acepta, y mientras tanto el corte vuelve a LIQUIDADO. Solo cabe uno
   * pendiente (409 `ABONO_PENDIENTE`), solo con el corte ya aceptado (409
   * `CORTE_SIN_ACEPTAR`: antes se corrige lo declarado) y nunca por mas de lo
   * que falta (409 `ABONO_EXCEDE_FALTANTE`).
   */
  async abonar(id: string, dto: RegistrarAbonoDto, usuario: UsuarioAutenticado): Promise<TurnoDto> {
    await this.prisma.$transaction(async (tx) => {
      // Bloqueado: dos abonos a la vez leerian el mismo adeudo y juntos lo pasarian.
      const turno = await PdvService.bloquearCortado(tx, id);
      PdvService.exigirPropio(turno, usuario);

      if (abonoPendiente(turno.abonos)) {
        throw PdvService.conflicto(
          'ABONO_PENDIENTE',
          'Ya hay un abono esperando a que Finanzas lo acepte. ' +
            'Si te equivocaste, cancélalo y regístralo de nuevo.',
        );
      }
      if (turno.recibidoEn === null) {
        throw PdvService.conflicto(
          'CORTE_SIN_ACEPTAR',
          'Finanzas todavía no acepta ese corte: corrige lo que declaraste.',
        );
      }

      const adeudo = adeudoDelCorte(PdvService.enCuenta(turno));
      const monto = new Decimal(dto.monto);
      if (monto.gt(adeudo.add(TOLERANCIA))) {
        throw PdvService.conflicto(
          'ABONO_EXCEDE_FALTANTE',
          adeudo.isZero()
            ? 'Ese corte ya está saldado: no hay nada que abonar.'
            : `El abono pasa de lo que falta: quedan $${adeudo.toFixed(2)}.`,
        );
      }

      await tx.turnoAbono.create({
        data: {
          turnoId: id,
          monto,
          registradoPorId: usuario.sub,
          registradoPorNombre: usuario.nombre,
          nota: dto.nota?.trim() || null,
        },
      });
      await tx.turnoPdv.update({
        where: { id },
        data: {
          estadoCorte: estadoTrasAceptar({
            ...PdvService.enCuenta(turno),
            abonos: [...turno.abonos, { monto, aceptadoEn: null }],
          }),
        },
      });
    });
    return this.dtoDe(id);
  }

  /**
   * Cancela el abono pendiente: se equivoco de monto o ese dinero no llego a
   * Finanzas. Se borra —nunca conto— y el corte vuelve al estatus que tenia.
   * Uno aceptado ya es un ingreso y no se toca (409 `ABONO_YA_ACEPTADO`).
   */
  async cancelarAbono(id: string, abonoId: string, usuario: UsuarioAutenticado): Promise<TurnoDto> {
    await this.prisma.$transaction(async (tx) => {
      const turno = await PdvService.bloquearCortado(tx, id);
      PdvService.exigirPropio(turno, usuario);

      const abono = turno.abonos.find((a) => a.id === abonoId);
      if (!abono) throw new NotFoundException('Abono no encontrado');
      if (abono.aceptadoEn !== null) {
        throw PdvService.conflicto(
          'ABONO_YA_ACEPTADO',
          'Finanzas ya aceptó ese abono: ya no se puede cancelar.',
        );
      }

      await tx.turnoAbono.delete({ where: { id: abonoId } });
      await tx.turnoPdv.update({
        where: { id },
        data: {
          estadoCorte: estadoTrasAceptar({
            ...PdvService.enCuenta(turno),
            abonos: turno.abonos.filter((a) => a.id !== abonoId),
          }),
        },
      });
    });
    return this.dtoDe(id);
  }

  // ----------------------------------------------------------------
  // Finanzas -> Cortes: los cortes de caja
  // ----------------------------------------------------------------

  /** Los cortes de caja de una pestana, de todas las tiendas, con sus conteos. */
  async cortesParaFinanzas(filtro: FiltroCortes, limite: number): Promise<ListadoCortesDeCajaDto> {
    const [turnos, ...cuentas] = await Promise.all([
      this.prisma.turnoPdv.findMany({
        where: WHERE_CORTES_DE_CAJA[filtro],
        orderBy: { cerradoEn: 'desc' },
        take: limite,
        include: INCLUIR_TURNO,
      }),
      ...Object.values(FiltroCortes).map((f) =>
        this.prisma.turnoPdv.count({ where: WHERE_CORTES_DE_CAJA[f] }),
      ),
    ]);
    const conteos = Object.fromEntries(
      Object.values(FiltroCortes).map((f, i) => [f, cuentas[i]]),
    ) as Record<FiltroCortes, number>;

    return { turnos: turnos.map((t) => PdvService.aDto(t)), conteos };
  }

  /** Un corte de caja abierto en Finanzas, con los pedidos de los que sale cada cifra. */
  async corteParaFinanzas(id: string): Promise<TurnoConPedidosDto> {
    const turno = await this.prisma.turnoPdv.findUnique({ where: { id }, include: INCLUIR_TURNO });
    // Un turno abierto no es un corte: para Finanzas todavia no existe.
    if (!turno || turno.cerradoEn === null) throw new NotFoundException('Corte no encontrado');
    return this.conPedidos(turno);
  }

  /**
   * "Aceptar dinero": Finanzas conto lo que el cajero entrega y es lo que
   * dijo. No captura otra cifra: acepta la que esta escrita, y si no coincide
   * con lo que tiene en la mano, el cajero la corrige.
   *
   * Acepta el dinero que este pendiente: el del corte la primera vez —lo
   * declarado pasa a ser el dinero aceptado y de ahi sale el adeudo—, o el
   * abono que el cajero registro despues. Cada uno deja su renglon en
   * Ingresos, en la misma transaccion.
   *
   * En caja no hay mercancia que revisar, asi que aceptar el dinero es aceptar
   * el corte: queda CERRADO si cubre lo que dice el sistema y ACEPTADO, con
   * adeudo, si no. **Quien acepta no puede ser el cajero del turno**, salvo el
   * administrador (409 `RECIBE_EL_MISMO`).
   */
  async aceptarDinero(id: string, usuario: UsuarioAutenticado): Promise<TurnoDto> {
    await this.prisma.$transaction(async (tx) => {
      // Bloqueado: dos pulsaciones a la vez aceptarian el mismo dinero dos veces.
      const turno = await PdvService.bloquearCortado(tx, id);
      if (turno.cajeroId === usuario.sub && !PdvService.esAdmin(usuario)) {
        throw PdvService.conflicto(
          'RECIBE_EL_MISMO',
          'No puedes aceptar tu propio corte: tiene que revisarlo alguien más.',
        );
      }

      const ahora = new Date();
      let efectivoRecibido = turno.efectivoRecibido;
      let abonos = turno.abonos;
      let aceptado: Prisma.Decimal;

      if (turno.recibidoEn === null) {
        aceptado = turno.efectivoDeclarado ?? new Decimal(0);
        efectivoRecibido = aceptado;
        await this.ingresos.registrar(tx, {
          concepto: ConceptoIngreso.PDV,
          referencia: turno.folio,
          monto: aceptado,
          metodo: MetodoPago.EFECTIVO,
          registradoPorId: usuario.sub,
          turnoPdvId: id,
        });
      } else {
        const pendiente = abonoPendiente(turno.abonos);
        if (!pendiente) {
          throw PdvService.conflicto(
            'SIN_DINERO_POR_ACEPTAR',
            'Ese corte no tiene dinero por aceptar.',
          );
        }
        aceptado = pendiente.monto;
        await tx.turnoAbono.update({
          where: { id: pendiente.id },
          data: {
            aceptadoEn: ahora,
            aceptadoPorId: usuario.sub,
            aceptadoPorNombre: usuario.nombre,
          },
        });
        abonos = turno.abonos.map((a) => (a.id === pendiente.id ? { ...a, aceptadoEn: ahora } : a));
        await this.ingresos.registrar(tx, {
          concepto: ConceptoIngreso.PDV,
          referencia: turno.folio,
          monto: aceptado,
          metodo: MetodoPago.EFECTIVO,
          nota: pendiente.nota,
          registradoPorId: usuario.sub,
          turnoPdvId: id,
          turnoAbonoId: pendiente.id,
        });
      }

      const recibidoEn = turno.recibidoEn ?? ahora;
      await tx.turnoPdv.update({
        where: { id },
        data: {
          ...(turno.recibidoEn === null && {
            efectivoRecibido,
            recibidoEn,
            recibidoPorId: usuario.sub,
            recibidoPorNombre: usuario.nombre,
          }),
          estadoCorte: estadoTrasAceptar({
            ...PdvService.enCuenta(turno),
            montoRecibido: efectivoRecibido,
            entregaAceptadaEn: recibidoEn,
            abonos,
          }),
        },
      });

      this.logger.log(
        `Dinero del corte de caja ${turno.folio} aceptado por ${usuario.nombre}: ` +
          `$${aceptado.toFixed(2)} (${turno.recibidoEn === null ? 'corte' : 'abono'})`,
      );
    });
    return this.dtoDe(id);
  }

  // ----------------------------------------------------------------
  // Clientes
  // ----------------------------------------------------------------

  /**
   * El cliente de ese telefono, o `null`: no es un 404, es que hay que pedirle
   * su nombre. Busca en las dos tablas, como el perfil.
   */
  async buscarCliente(telefono: string): Promise<ClientePdvDto | null> {
    const candidatos = PdvService.variantesDe(telefono);
    const cliente = await this.prisma.cliente.findFirst({
      where: { telefono: { in: candidatos } },
      select: { ...CAMPOS_DIRECCION, saldoCashback: true },
    });
    if (cliente) return PdvService.aCliente(cliente, false, cliente.saldoCashback.toNumber());

    const prospecto = await this.prisma.prospecto.findFirst({
      where: { telefono: { in: candidatos } },
      select: CAMPOS_DIRECCION,
    });
    return prospecto ? PdvService.aCliente(prospecto, true, 0) : null;
  }

  /**
   * Autocompletado del telefono: quienes ya estan registrados y cuyo numero
   * contiene lo tecleado. "Contiene" y no "empieza por" porque el login pudo
   * guardarlo con lada (`+52...`) y el cajero teclea los 10 digitos.
   *
   * Los clientes van antes que los prospectos: es mas probable que quien esta
   * en el mostrador ya haya comprado.
   */
  async sugerirClientes(digitos: string): Promise<ClientePdvDto[]> {
    const where = { telefono: { contains: digitos } };
    const [clientes, prospectos] = await Promise.all([
      this.prisma.cliente.findMany({
        where,
        select: { ...CAMPOS_DIRECCION, saldoCashback: true },
        orderBy: { ultimoPedido: { sort: 'desc', nulls: 'last' } },
        take: LIMITE_SUGERENCIAS,
      }),
      this.prisma.prospecto.findMany({
        where,
        select: CAMPOS_DIRECCION,
        orderBy: { creado: 'desc' },
        take: LIMITE_SUGERENCIAS,
      }),
    ]);
    return [
      ...clientes.map((c) => PdvService.aCliente(c, false, c.saldoCashback.toNumber())),
      ...prospectos.map((p) => PdvService.aCliente(p, true, 0)),
    ].slice(0, LIMITE_SUGERENCIAS);
  }

  /**
   * Da de alta a quien llega al mostrador sin registro. Entra como prospecto,
   * igual que quien se registra en la app: se vuelve cliente al confirmar su
   * primer pedido, que es lo que viene a hacer.
   */
  async registrarCliente(dto: RegistrarClienteDto): Promise<ClientePdvDto> {
    const existente = await this.buscarCliente(dto.telefono);
    if (existente) return existente;

    const prospecto = await this.prisma.prospecto.create({
      data: { telefono: AuthService.normalizarTelefono(dto.telefono), nombre: dto.nombre.trim() },
      select: CAMPOS_DIRECCION,
    });
    return PdvService.aCliente(prospecto, true, 0);
  }

  /**
   * El catalogo en el orden de ese cliente —el mismo que veria en la Tienda—
   * visto desde el anaquel de esa tienda.
   *
   * Salen todos los productos, pero el mostrador solo vende lo que la tienda
   * tiene: cada uno lleva `enTienda` y el que esta en cero viaja como agotado
   * aunque en bodega haya. Cada tienda tiene su inventario, y aqui manda ese.
   */
  async catalogo(clienteId: string, tiendaId: string): Promise<CatalogoPdvDto> {
    const [catalogo, disponibles] = await Promise.all([
      this.recomendaciones.catalogoPara(clienteId),
      this.tiendas.disponibles(tiendaId),
    ]);
    return {
      ...catalogo,
      familias: catalogo.familias.map((familia) => ({
        ...familia,
        productos: familia.productos.map((producto) => {
          const enTienda = disponibles.get(producto.id) ?? 0;
          return { ...producto, enTienda, agotado: producto.agotado || enTienda <= 0 };
        }),
      })),
    };
  }

  ultimoPedido(clienteId: string): Promise<UltimoPedidoDto | null> {
    return this.pedidos.ultimoPedido(clienteId);
  }

  // ----------------------------------------------------------------
  // Pedidos del turno
  // ----------------------------------------------------------------

  async previsualizar(
    turnoId: string,
    dto: PrevisualizarPdvDto,
    usuario: UsuarioAutenticado,
  ): Promise<PrevisualizacionCarritoDto> {
    const turno = await this.exigirAbierto(turnoId, usuario);
    const { clienteId, ...carrito } = dto;
    const metodoEntrega = carrito.metodoEntrega ?? MetodoEntrega.TIENDA;
    const previa = await this.carrito.previsualizar(clienteId, { ...carrito, metodoEntrega }, true);

    // Lo que no hay en la tienda apaga «Confirmar pedido» con el motivo a la
    // vista, en vez de dejar que el cajero choque con el 409 al confirmar.
    const faltantes = await this.tiendas.faltantes(turno.tiendaId, carrito.items);
    if (faltantes.length === 0) return previa;
    return {
      ...previa,
      puedePedir: false,
      avisos: [...previa.avisos, ...faltantes.map((f) => TiendasService.mensajeDeFaltante(f))],
    };
  }

  /**
   * "Confirmar pedido". Es el checkout de la app hecho por el cajero: mismos
   * precios, mismo cashback, misma billetera.
   *
   * A domicilio se entrega en la direccion del perfil del cliente (409
   * `SIN_DIRECCION` si no la tiene completa) y sigue el camino de siempre:
   * Operaciones lo prepara y Rutas lo lleva.
   *
   * Solo se confirma lo que la tienda del turno tiene (409
   * `SIN_EXISTENCIA_EN_TIENDA`), se lo lleve o se le mande: el punto de venta
   * vende desde su tienda. Y se cobra de contado: nace PAGADO.
   */
  async crearPedido(
    turnoId: string,
    dto: CrearPedidoPdvDto,
    usuario: UsuarioAutenticado,
  ): Promise<PedidoDto> {
    const turno = await this.exigirAbierto(turnoId, usuario);
    const metodoEntrega = dto.metodoEntrega ?? MetodoEntrega.TIENDA;

    const faltantes = await this.tiendas.faltantes(turno.tiendaId, dto.items);
    if (faltantes.length > 0) {
      throw PdvService.conflicto(
        'SIN_EXISTENCIA_EN_TIENDA',
        faltantes.map((f) => TiendasService.mensajeDeFaltante(f)).join(' '),
      );
    }

    return this.pedidos.crear(
      dto.clienteId,
      {
        items: dto.items,
        metodoPago: dto.metodoPago,
        pagoCon: dto.pagoCon,
        usarBilletera: dto.usarBilletera,
        metodoEntrega,
        direccion:
          metodoEntrega === MetodoEntrega.DOMICILIO
            ? await this.direccionDelPerfil(dto.clienteId)
            : undefined,
      },
      { turnoId, cajero: actorDe(usuario) },
    );
  }

  /**
   * "Entregado": el cliente se lleva su pedido.
   *
   * En una transaccion, la mercancia sale del inventario de la tienda del
   * turno y el pedido salta a ENTREGADO —en mostrador no hay preparacion ni
   * ruta que recorrer—. Ya viene PAGADO desde que se confirmo; el
   * `marcarPagado` de abajo queda para los que se confirmaron antes de ese
   * cambio y siguen pendientes, y no toca a los demas. Uno al que Finanzas le
   * dio credito se entrega sin cobrar y pasa a cuenta por cobrar.
   *
   * Con `controlInventario` encendido no se entrega lo que la tienda no tiene
   * (409 `SIN_EXISTENCIA_EN_TIENDA`); apagado, el saldo baja hasta donde haya.
   */
  async entregar(pedidoId: string, usuario: UsuarioAutenticado): Promise<PedidoDto> {
    const controlInventario = (await this.configuracion.obtener()).controlInventario;
    const quien = actorDe(usuario);

    await this.prisma.$transaction(async (tx) => {
      await FlujoPedidosService.bloquearFila(tx, pedidoId);
      const pedido = await tx.pedido.findUniqueOrThrow({
        where: { id: pedidoId },
        select: {
          folio: true,
          estado: true,
          estadoPago: true,
          metodoEntrega: true,
          cxcDesde: true,
          turno: true,
          items: { select: { productoId: true, cantidad: true } },
        },
      });

      if (!pedido.turno) {
        throw PdvService.conflicto(
          'NO_ES_DEL_PDV',
          `El pedido ${pedido.folio} no se capturó en el punto de venta.`,
        );
      }
      PdvService.exigirPropio(pedido.turno, usuario);
      PdvService.exigirSinCerrar(pedido.turno);
      if (pedido.metodoEntrega !== MetodoEntrega.TIENDA) {
        throw PdvService.conflicto(
          'SOLO_EN_TIENDA',
          'Los pedidos a domicilio los entrega Rutas, no el mostrador.',
        );
      }
      if (pedido.estado === EstadoPedido.ENTREGADO) {
        throw PdvService.conflicto('YA_ENTREGADO', `El pedido ${pedido.folio} ya se entregó.`);
      }
      if (pedido.estadoPago === EstadoPago.CANCELADO) {
        throw PdvService.conflicto('PEDIDO_CANCELADO', 'El pedido está cancelado.');
      }
      if (pedido.estadoPago === EstadoPago.RETENER) {
        throw PdvService.conflicto(
          'PAGO_RETENIDO',
          'Finanzas retuvo el pedido: debe liberarlo antes de entregarlo.',
        );
      }

      await this.tiendas.salir(tx, pedido.turno.tiendaId, pedido.items, controlInventario);

      await FlujoPedidosService.aplicar(
        tx,
        pedidoId,
        { de: pedido.estado, a: EstadoPedido.ENTREGADO, seccion: 'pdv', exigeLiberado: true },
        quien,
        'Entregado en el punto de venta',
      );

      if (pedido.estadoPago === EstadoPago.CREDITO) {
        if (pedido.cxcDesde === null) {
          await tx.pedido.update({ where: { id: pedidoId }, data: { cxcDesde: new Date() } });
        }
      } else {
        await this.finanzas.marcarPagado(tx, pedidoId, quien, 'Cobrado en el punto de venta');
      }
    });

    return this.pedidos.detalle(pedidoId);
  }

  // ----------------------------------------------------------------

  private async dtoDe(id: string): Promise<TurnoDto> {
    const turno = await this.prisma.turnoPdv.findUniqueOrThrow({
      where: { id },
      include: INCLUIR_TURNO,
    });
    return PdvService.aDto(turno);
  }

  private async conPedidos(turno: TurnoCompleto): Promise<TurnoConPedidosDto> {
    const pedidos = await this.pedidos.buscar(
      { turnoId: turno.id },
      { creadoEn: 'desc' },
      LIMITE_PEDIDOS,
    );
    return {
      ...PdvService.aDto(turno),
      pedidos,
      // Sale de los mismos pedidos que viajan: la tabla y su suma no divergen.
      productosEntregados: productosEntregados(
        pedidos.map((p) => ({
          estado: p.estado,
          estadoPago: p.pago.estado,
          metodoEntrega: p.metodoEntrega,
          items: p.items,
        })),
      ).map((p) => ({ ...p, importe: p.importe.toNumber() })),
    };
  }

  private async exigirAbierto(turnoId: string, usuario: UsuarioAutenticado): Promise<TurnoPdv> {
    const turno = await this.prisma.turnoPdv.findUnique({ where: { id: turnoId } });
    if (!turno) throw new NotFoundException('Turno no encontrado');
    PdvService.exigirPropio(turno, usuario);
    PdvService.exigirSinCerrar(turno);
    return turno;
  }

  /** Bloquea la fila del turno hasta el final de la transaccion y exige que siga abierto. */
  private static async bloquearAbierto(
    tx: Prisma.TransactionClient,
    id: string,
    usuario: UsuarioAutenticado,
  ): Promise<{ pedidos: PedidoDelTurno[] }> {
    const filas = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM turnos_pdv WHERE id = ${id} FOR UPDATE
    `;
    if (filas.length === 0) throw new NotFoundException('Turno no encontrado');

    const turno = await tx.turnoPdv.findUniqueOrThrow({ where: { id }, include: INCLUIR_TURNO });
    PdvService.exigirPropio(turno, usuario);
    PdvService.exigirSinCerrar(turno);
    return turno;
  }

  /** Bloquea la fila de un turno que ya tiene su corte: lo que sigue es su dinero. */
  private static async bloquearCortado(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<TurnoCompleto> {
    const filas = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM turnos_pdv WHERE id = ${id} FOR UPDATE
    `;
    if (filas.length === 0) throw new NotFoundException('Turno no encontrado');

    const turno = await tx.turnoPdv.findUniqueOrThrow({ where: { id }, include: INCLUIR_TURNO });
    if (turno.cerradoEn === null) {
      throw PdvService.conflicto(
        'TURNO_SIN_CORTE',
        `El turno ${turno.folio} todavía no tiene su corte de caja.`,
      );
    }
    return turno;
  }

  /**
   * El turno dicho como lo entienden las cuentas del corte de ruta
   * (`estado-del-corte`), para que el adeudo y el estatus salgan de la misma
   * regla. En caja no hay mercancia que revisar: aceptar el dinero es aceptar
   * el corte, asi que la "entrega aceptada" es la fecha en que se recibio.
   */
  private static enCuenta(
    turno: Pick<TurnoCompleto, 'efectivoCalculado' | 'efectivoRecibido' | 'recibidoEn' | 'abonos'>,
  ): CorteEnCuenta {
    return {
      montoCalculado: turno.efectivoCalculado ?? new Decimal(0),
      montoRecibido: turno.efectivoRecibido,
      entregaAceptadaEn: turno.recibidoEn,
      abonos: turno.abonos,
    };
  }

  /** La caja es de quien la abrio. El administrador puede verla y cerrarla. */
  private static exigirPropio(
    turno: Pick<TurnoPdv, 'cajeroId'>,
    usuario: UsuarioAutenticado,
  ): void {
    if (turno.cajeroId !== usuario.sub && !PdvService.esAdmin(usuario)) {
      throw new ForbiddenException('Ese turno es de otro cajero.');
    }
  }

  private static exigirSinCerrar(turno: Pick<TurnoPdv, 'cerradoEn' | 'folio'>): void {
    if (turno.cerradoEn !== null) {
      throw PdvService.conflicto(
        'TURNO_CERRADO',
        `El turno ${turno.folio} ya tiene su corte de caja.`,
      );
    }
  }

  private static esAdmin(usuario: UsuarioAutenticado): boolean {
    return usuario.rol === RolUsuario.ADMINISTRADOR;
  }

  private static conflicto(code: string, message: string): ConflictException {
    return new ConflictException({ statusCode: 409, code, message });
  }

  /**
   * La direccion del perfil, con la forma que espera el checkout. El pedido
   * guarda su copia, asi que editar el perfil despues no la cambia.
   */
  private async direccionDelPerfil(clienteId: string): Promise<DireccionEntregaDto> {
    const perfil =
      (await this.prisma.cliente.findUnique({
        where: { id: clienteId },
        select: CAMPOS_DIRECCION,
      })) ??
      (await this.prisma.prospecto.findUnique({
        where: { id: clienteId },
        select: CAMPOS_DIRECCION,
      }));
    if (!perfil) throw new NotFoundException('Cliente no encontrado');

    const { calle, colonia, cp, ciudad } = perfil;
    if (!calle?.trim() || !colonia?.trim() || !cp?.trim() || !ciudad?.trim()) {
      throw PdvService.conflicto(
        'SIN_DIRECCION',
        `${perfil.nombre} no tiene una dirección completa en su perfil: no se le puede enviar a domicilio.`,
      );
    }
    return {
      quienRecibe: perfil.quienRecibe?.trim() || perfil.nombre,
      telefono: perfil.telefono.replace(/\D/g, '').slice(-10),
      calle,
      colonia,
      cp,
      ciudad,
      estado: perfil.estado,
      referencias: perfil.referencias,
      lat: perfil.lat,
      lng: perfil.lng,
    };
  }

  /**
   * El mismo telefono como pudo haberse guardado. El login lo normaliza a
   * digitos y conserva el `+` si venia con lada; en el mostrador se teclean
   * los 10 digitos, asi que se prueba tambien con las ladas de Mexico.
   */
  private static variantesDe(telefono: string): string[] {
    const normalizado = AuthService.normalizarTelefono(telefono);
    const digitos = normalizado.replace(/\D/g, '');
    const local = digitos.slice(-10);
    return [...new Set([normalizado, digitos, local, `52${local}`, `+52${local}`, `+521${local}`])];
  }

  private static aCliente(
    perfil: PerfilConDireccion,
    esNuevo: boolean,
    saldoBilletera: number,
  ): ClientePdvDto {
    const { calle, colonia, cp, ciudad } = perfil;
    const completa = [calle, colonia, cp, ciudad].every((campo) => campo?.trim());
    return {
      id: perfil.id,
      nombre: perfil.nombre,
      telefono: perfil.telefono,
      esNuevo,
      saldoBilletera,
      direccion: completa ? `${calle}, ${colonia}, CP ${cp}, ${ciudad}` : null,
    };
  }

  /** Folio servido por una secuencia de Postgres, como los demas. */
  private static async siguienteFolio(tx: Prisma.TransactionClient): Promise<string> {
    const filas = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('turnos_pdv_folio_seq')`;
    return `TUR${String(filas[0].nextval).padStart(6, '0')}`;
  }

  private static aDto(turno: TurnoCompleto): TurnoDto {
    const totales = totalesDelTurno(turno.pedidos);
    return {
      id: turno.id,
      folio: turno.folio,
      tienda: turno.tienda,
      cajero: turno.cajeroNombre,
      abiertoEn: turno.abiertoEn.toISOString(),
      cerradoEn: turno.cerradoEn?.toISOString() ?? null,
      totales: {
        pedidos: totales.pedidos,
        cobrados: totales.cobrados,
        porEntregar: totales.porEntregar,
        aDomicilio: totales.aDomicilio,
        cancelados: totales.cancelados,
        ventas: totales.ventas.toNumber(),
        // En un turno cerrado manda lo que se congelo en el corte.
        efectivo: (turno.efectivoCalculado ?? totales.efectivo).toNumber(),
        transferencia: totales.transferencia.toNumber(),
        billetera: totales.billetera.toNumber(),
      },
      efectivoDeclarado: turno.efectivoDeclarado?.toNumber() ?? null,
      diferencia:
        turno.efectivoDeclarado && turno.efectivoCalculado
          ? turno.efectivoDeclarado.sub(turno.efectivoCalculado).toNumber()
          : null,
      notas: turno.notas,
      corte: PdvService.corteDe(turno),
    };
  }

  private static corteDe(turno: TurnoCompleto): CorteDeTurnoDto | null {
    if (turno.estadoCorte === null) return null;
    const porAceptar =
      turno.recibidoEn === null ? turno.efectivoDeclarado : abonoPendiente(turno.abonos)?.monto;
    return {
      estado: turno.estadoCorte,
      efectivoRecibido: turno.efectivoRecibido?.toNumber() ?? null,
      recibidoEn: turno.recibidoEn?.toISOString() ?? null,
      recibidoPorNombre: turno.recibidoPorNombre,
      saldoPendiente: adeudoDelCorte(PdvService.enCuenta(turno)).toNumber(),
      dineroPorAceptar: porAceptar?.toNumber() ?? null,
      abonos: turno.abonos.map((a) => ({
        id: a.id,
        monto: a.monto.toNumber(),
        registradoPorNombre: a.registradoPorNombre,
        nota: a.nota,
        creadoEn: a.creadoEn.toISOString(),
        aceptadoEn: a.aceptadoEn?.toISOString() ?? null,
      })),
    };
  }
}
