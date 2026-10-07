import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoPago,
  EstadoPedido,
  MetodoEntrega,
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
  RecomendacionesService,
} from '../catalogo/recomendaciones.service';
import { actorDe } from '../pedidos/bitacora';
import { CarritoService, PrevisualizacionCarritoDto } from '../pedidos/carrito.service';
import { DireccionEntregaDto } from '../pedidos/dto/carrito.dto';
import { FinanzasService } from '../pedidos/finanzas.service';
import { FlujoPedidosService } from '../pedidos/flujo-pedidos.service';
import { PedidoDto, PedidosService, UltimoPedidoDto } from '../pedidos/pedidos.service';
import { TiendasService } from '../tiendas/tiendas.service';
import { PedidoDelTurno, totalesDelTurno } from './corte-de-caja';
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
}

export type TurnoConPedidosDto = TurnoDto & { pedidos: PedidoDto[] };

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
  ) {}

  // ----------------------------------------------------------------
  // Turnos
  // ----------------------------------------------------------------

  /** El turno abierto de quien pregunta, con sus pedidos, o `null`. */
  async turnoAbierto(usuario: UsuarioAutenticado): Promise<TurnoConPedidosDto | null> {
    const turno = await this.prisma.turnoPdv.findFirst({
      where: { cajeroId: usuario.sub, cerradoEn: null },
      include: INCLUIR_TURNO,
    });
    return turno ? this.conPedidos(turno) : null;
  }

  /**
   * "Crear turno". Tener ya uno abierto es 409 `TURNO_ABIERTO`; el indice
   * parcial `turnos_pdv_uno_abierto` es quien de verdad lo impide, y su P2002
   * se traduce al mismo codigo.
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
      return { ...PdvService.aDto(turno), pedidos: [] };
    } catch (fallo) {
      if (fallo instanceof Prisma.PrismaClientKnownRequestError && fallo.code === 'P2002') {
        throw new ConflictException({
          statusCode: 409,
          code: 'TURNO_ABIERTO',
          message: 'Ya tienes un turno abierto: haz su corte de caja antes de crear otro.',
        });
      }
      throw fallo;
    }
  }

  /** Corte de caja: los turnos, del mas reciente al mas viejo. El cajero ve los suyos. */
  async listar(usuario: UsuarioAutenticado): Promise<TurnoDto[]> {
    const turnos = await this.prisma.turnoPdv.findMany({
      where: PdvService.esAdmin(usuario) ? {} : { cajeroId: usuario.sub },
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
        },
        include: INCLUIR_TURNO,
      });
    });
    this.logger.log(`Corte de caja del turno ${cerrado.folio} por ${usuario.nombre}`);
    return this.conPedidos(cerrado);
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

  /** El catalogo en el orden de ese cliente: el mismo que veria en la Tienda. */
  catalogo(clienteId: string): Promise<CatalogoRecomendadoDto> {
    return this.recomendaciones.catalogoPara(clienteId);
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
    await this.exigirAbierto(turnoId, usuario);
    const { clienteId, ...carrito } = dto;
    return this.carrito.previsualizar(
      clienteId,
      { ...carrito, metodoEntrega: carrito.metodoEntrega ?? MetodoEntrega.TIENDA },
      true,
    );
  }

  /**
   * "Confirmar pedido". Es el checkout de la app hecho por el cajero: mismos
   * precios, mismo cashback, misma billetera.
   *
   * A domicilio se entrega en la direccion del perfil del cliente (409
   * `SIN_DIRECCION` si no la tiene completa) y sigue el camino de siempre:
   * Operaciones lo prepara y Rutas lo lleva.
   */
  async crearPedido(
    turnoId: string,
    dto: CrearPedidoPdvDto,
    usuario: UsuarioAutenticado,
  ): Promise<PedidoDto> {
    await this.exigirAbierto(turnoId, usuario);
    const metodoEntrega = dto.metodoEntrega ?? MetodoEntrega.TIENDA;

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
   * "Entregado": el cliente se lleva su pedido y lo paga ahi mismo.
   *
   * Tres cosas en una transaccion: la mercancia sale del inventario de la
   * tienda del turno, el pedido salta a ENTREGADO —en mostrador no hay
   * preparacion ni ruta que recorrer— y queda PAGADO, con lo que eso arrastra
   * (cashback). Uno al que Finanzas le dio credito se entrega sin cobrar y
   * pasa a cuenta por cobrar.
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

  private async conPedidos(turno: TurnoCompleto): Promise<TurnoConPedidosDto> {
    return {
      ...PdvService.aDto(turno),
      pedidos: await this.pedidos.buscar(
        { turnoId: turno.id },
        { creadoEn: 'desc' },
        LIMITE_PEDIDOS,
      ),
    };
  }

  private async exigirAbierto(turnoId: string, usuario: UsuarioAutenticado): Promise<void> {
    const turno = await this.prisma.turnoPdv.findUnique({ where: { id: turnoId } });
    if (!turno) throw new NotFoundException('Turno no encontrado');
    PdvService.exigirPropio(turno, usuario);
    PdvService.exigirSinCerrar(turno);
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
    };
  }
}
