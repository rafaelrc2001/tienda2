import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorBitacora,
  Cliente,
  EjeBitacora,
  EstadoCupon,
  EstadoPago,
  EstadoPedido,
  MetodoEntrega,
  MetodoPago,
  Pedido,
  Prisma,
  Prospecto,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { CuponesService } from '../cupones/cupones.service';
import { CashbackService } from '../cashback/cashback.service';
import { precioUnitario } from '../catalogo/precios';
import { CarritoService } from './carrito.service';
import { InventarioService } from '../inventario/inventario.service';
import { CrearPedidoDto, DireccionEntregaDto } from './dto/carrito.dto';
import { registrarEnBitacora } from './bitacora';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export interface PedidoDto {
  id: string;
  folio: string;
  clienteId: string;
  clienteNombre?: string;
  subtotal: number;
  envio: number;
  recargoFuera: number;
  descuento: number;
  total: number;
  cashbackGenerado: number;
  /** false mientras el pago no quede PAGADO: el cashback aun no esta en la billetera. */
  cashbackAcreditado: boolean;
  estado: EstadoPedido;
  pago: {
    metodo: MetodoPago;
    estado: EstadoPago;
    billetera: number;
    /** Lo que se cobra en efectivo o por transferencia. */
    aPagar: number;
    pagoCon: number | null;
    cambio: number | null;
    /** Transferencia: lo que el cliente pone como concepto. Es el folio. */
    referencia: string;
  };
  metodoEntrega: MetodoEntrega;
  /** Snapshot de la direccion del pedido; `null` si se recoge en tienda. */
  direccion: Record<string, unknown> | null;
  cupon: { code: string; titulo: string } | null;
  items: {
    productoId: string;
    nombre: string;
    categoria: string;
    unidad: string;
    precioUnitario: number;
    cantidad: number;
    importe: number;
  }[];
  creadoEn: string;
}

/**
 * El ultimo pedido, listo para repetirlo (HU-04).
 *
 * Lleva las cantidades de aquel pedido pero **los precios de hoy**: es una
 * propuesta de compra, no un recibo. Repetir un pedido de hace tres meses a los
 * precios de hace tres meses seria ensenar un total que la caja no va a
 * respetar. Para eso esta `Mis Pedidos`, que si es el historico.
 */
export interface UltimoPedidoDto {
  folio: string;
  creadoEn: string;
  /** Snapshot de la direccion a la que se entrego aquel pedido. */
  direccion: Record<string, unknown> | null;
  items: {
    productoId: string;
    nombre: string;
    unidad: string;
    cantidad: number;
    /** Lo que cuesta hoy. */
    precioUnitario: number;
    importe: number;
    /** Lo que costo entonces. Sirve para avisar de que el precio cambio. */
    precioAnterior: number;
    /** Sigue existiendo y no esta agotado. */
    disponible: boolean;
  }[];
  /** Suma de lo disponible, a precio de hoy. */
  subtotal: number;
  avisos: string[];
}

@Injectable()
export class PedidosService {
  private readonly logger = new Logger(PedidosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly carrito: CarritoService,
    private readonly configuracion: ConfiguracionService,
    private readonly cupones: CuponesService,
    private readonly cashback: CashbackService,
    private readonly inventario: InventarioService,
  ) {}

  /**
   * Confirma el pedido (Word 4.3).
   *
   * Todo ocurre dentro de una transaccion: si algo falla, no queda un pedido
   * a medias con el cupon ya quemado. Los pasos, en orden:
   *
   *  1. Resolver el carrito contra la base (precios reales, nada del cliente).
   *  2. Calcular envio y recargo fuera de horario.
   *  3. Bloquear la fila del cupon y revalidarlo.
   *  4. Convertir al prospecto en cliente, si es su primera compra.
   *  5. Crear el pedido y sus lineas.
   *  6. Marcar el cupon como USED.
   *  7. Cancelar el WELCOME sobrante.
   *  8. Descontar lo vendido de la bodega, si el control de inventario esta
   *     encendido.
   *  9. Actualizar los contadores del cliente.
   * 10. Emitir el cupon de segunda compra si corresponde.
   * 11. Recalcular el nivel y abrir la bitacora del pedido.
   * 12. Acreditar el cashback, solo si ya nace pagado.
   */
  async crear(duenioId: string, dto: CrearPedidoDto): Promise<PedidoDto> {
    // `duenioId` puede ser un cliente o un prospecto: este es el pedido que lo
    // convierte. Todavia no se toca nada, solo se comprueba que existe en
    // alguna de las dos tablas.
    const cliente = await this.prisma.cliente.findUnique({ where: { id: duenioId } });
    const prospecto = cliente
      ? null
      : await this.prisma.prospecto.findUnique({ where: { id: duenioId } });

    const quien = cliente ?? prospecto;
    if (!quien) throw new NotFoundException('Cliente no encontrado');
    if (!quien.nombre?.trim()) {
      throw new ConflictException('Completa tu nombre en Mi Perfil antes de pedir.');
    }

    const config = await this.configuracion.obtener();
    const dentroDeHorario = ConfiguracionService.estaDentroDeHorario(config);
    if (!dentroDeHorario && !config.atenderFuera) {
      throw new ConflictException(
        `Ahora mismo no estamos recibiendo pedidos. Nuestro horario es de ${config.abre} a ${config.cierra}.`,
      );
    }

    // El % se fija con el nivel que tenia al pedir, antes de que este pedido le
    // sume gasto: es el mismo que vio en la previsualizacion. Un prospecto cae
    // en el nivel de entrada.
    const porcentajeCashback = await this.cashback.porcentajePara(duenioId);

    return this.prisma.$transaction(async (tx) => {
      const carrito = await this.carrito.resolver(dto.items);
      const subtotal = carrito.subtotal;

      let descuento = new Decimal(0);
      let cuponId: string | null = null;

      if (dto.codigoCupon) {
        // Con el id del token, no con el del cliente que se creara luego: el
        // cupon de bienvenida todavia cuelga del prospecto en este punto.
        const validacion = await this.carrito.exigirCuponValido(duenioId, dto.codigoCupon, carrito);

        // Se bloquea la fila del cupon hasta el final de la transaccion. Sin
        // esto, dos pedidos simultaneos del mismo cliente podrian canjear el
        // mismo cupon dos veces.
        const bloqueado = await tx.$queryRaw<{ id: string; status: EstadoCupon }[]>`
          SELECT id, status FROM cupones_emitidos WHERE id = ${validacion.cuponId} FOR UPDATE
        `;
        if (bloqueado[0]?.status !== EstadoCupon.ACTIVE) {
          throw new ConflictException('Ese cupón acaba de usarse en otro pedido.');
        }

        cuponId = validacion.cuponId;
        descuento = new Decimal(validacion.descuento);
      }

      // Se bloquea el saldo hasta el final de la transaccion, por la misma
      // razon que el cupon: dos pedidos simultaneos no pueden gastar el mismo
      // peso. Un prospecto no tiene fila y su saldo es cero.
      const usarBilletera = new Decimal(dto.usarBilletera ?? 0);
      let saldo = new Decimal(0);
      if (cliente) {
        const filas = await tx.$queryRaw<{ saldoCashback: Decimal }[]>`
          SELECT "saldoCashback" FROM clientes WHERE id = ${cliente.id} FOR UPDATE
        `;
        saldo = new Decimal(filas[0]?.saldoCashback ?? 0);
      }

      // Mismo calculo que devuelve POST /carrito/previsualizar. La billetera se
      // valida contra el total ya con el cupon, y aqui si se lanza: el cliente
      // tiene que ver el total real antes de confirmar.
      const metodoEntrega = dto.metodoEntrega ?? MetodoEntrega.DOMICILIO;
      const sinBilletera = CarritoService.calcularCarrito(
        carrito,
        config,
        dentroDeHorario,
        porcentajeCashback,
        descuento,
        new Decimal(0),
        metodoEntrega,
      );
      const billetera = CarritoService.validarBilletera(usarBilletera, saldo, sinBilletera.total);
      if (billetera.error) {
        throw new ConflictException({
          statusCode: 409,
          code: billetera.error.codigo,
          message: billetera.error.mensaje,
        });
      }

      const desglose = CarritoService.calcularCarrito(
        carrito,
        config,
        dentroDeHorario,
        porcentajeCashback,
        descuento,
        billetera.monto,
        metodoEntrega,
      );
      const { envio, recargoFuera, total, aPagar } = desglose;

      const pago = CarritoService.evaluarPago(dto.metodoPago, dto.pagoCon, aPagar);
      if (pago.error) {
        throw new BadRequestException({
          statusCode: 400,
          code: pago.error.codigo,
          message: pago.error.mensaje,
        });
      }

      // Cubierto entero con la billetera no hay nada que cobrar. Si no, nace en
      // PAGO_PENDIENTE sea cual sea el metodo: Finanzas decide si lo libera
      // para entregar (efectivo) o lo marca pagado (transferencia validada).
      const estadoPago = aPagar.greaterThan(0) ? EstadoPago.PAGO_PENDIENTE : EstadoPago.PAGADO;
      const enEfectivo = dto.metodoPago === MetodoPago.EFECTIVO && aPagar.greaterThan(0);

      const folio = await PedidosService.siguienteFolio(tx);
      const ahora = new Date();

      // Aqui es donde un prospecto se vuelve cliente: al confirmar, no al
      // registrarse. Dentro de la transaccion, para que no quede un cliente
      // creado si el pedido acaba fallando.
      const comprador = prospecto ? await this.convertir(tx, prospecto) : cliente!;
      const clienteId = comprador.id;

      const pedido = await tx.pedido.create({
        data: {
          folio,
          clienteId,
          subtotal,
          envio,
          recargoFuera,
          descuento,
          total,
          metodoPago: dto.metodoPago,
          estadoPago,
          pagadoConBilletera: billetera.monto,
          pagoCon: enEfectivo ? new Decimal(dto.pagoCon as number) : null,
          cambio: enEfectivo ? pago.cambio : null,
          pagoValidadoEn: estadoPago === EstadoPago.PAGADO ? new Date() : null,
          metodoEntrega,
          // Se congela aqui y no al acreditarse: es el que vio el cliente al
          // confirmar, aunque su nivel cambie antes de que se le pague.
          cashbackGenerado: desglose.cashbackBilletera,
          porcentajeCashback,
          estado: EstadoPedido.CONFIRMADO,
          direccion: PedidosService.copiaDireccion(metodoEntrega, dto.direccion),
          items: {
            create: carrito.lineas.map((l) => ({
              productoId: l.productoId,
              nombre: l.nombre,
              categoria: l.categoria,
              unidad: l.unidad,
              precioUnitario: l.precioUnitario,
              cantidad: l.cantidad,
            })),
          },
        },
      });

      if (cuponId) {
        await tx.cuponEmitido.update({
          where: { id: cuponId },
          data: {
            status: EstadoCupon.USED,
            usedAt: ahora,
            usedPedidoId: pedido.id,
            discountApplied: descuento,
          },
        });
      }

      // El saldo sale de la billetera con su renglon, igual que entra el
      // cashback: el estado de cuenta se explica solo. Va antes de acreditar el
      // cashback de este pedido, que por tanto no se puede gastar en el mismo.
      if (billetera.monto.greaterThan(0)) {
        await tx.movimientoCashback.create({
          data: {
            clienteId,
            pedidoId: pedido.id,
            monto: billetera.monto.negated(),
            concepto: `Pago del pedido ${folio}`,
          },
        });
        await tx.cliente.update({
          where: { id: clienteId },
          data: { saldoCashback: { decrement: billetera.monto } },
        });
      }

      // Word 5, regla 4: el cupon de Bienvenida solo vale para la primera
      // compra. Si sigue activo despues de comprar, ya no corresponde.
      const cancelados = await tx.cuponEmitido.updateMany({
        where: { clienteId, sourceCode: 'WELCOME', status: EstadoCupon.ACTIVE },
        data: { status: EstadoCupon.CANCELLED },
      });
      if (cancelados.count > 0) {
        this.logger.log(`WELCOME cancelado para ${clienteId} tras su primera compra`);
      }

      // Lo vendido sale de la bodega dentro de esta misma transaccion: si el
      // pedido no se guarda, el saldo no se movio. Si a algun renglon no le
      // alcanza, revienta aqui con su 409 y el pedido entero no ocurre —mejor
      // que aceptarlo y descubrir en el almacen que no habia.
      //
      // Cuando el control esta apagado no se toca nada: al estrenar el modulo
      // todos los productos estan en cero y bloquear las ventas por un saldo
      // que nadie ha capturado seria cerrar la tienda.
      if (config.controlInventario) {
        await this.inventario.registrarVenta(
          tx,
          pedido.id,
          folio,
          carrito.lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad })),
        );
      }

      const clienteActualizado = await tx.cliente.update({
        where: { id: clienteId },
        data: {
          pedidos: { increment: 1 },
          totalGastado: { increment: total },
          ultimoPedido: ahora,
          ...(comprador.primerPedido === null && { primerPedido: ahora }),
          // El carrito guardado ya se convirtio en este pedido. Borrarlo aqui
          // —y no fiarse de que el navegador mande el vacio— evita que quien
          // entre manana desde otro telefono se encuentre repetido lo que ya
          // compro.
          carrito: Prisma.DbNull,
          carritoEn: null,
          // La direccion de este pedido ya quedo copiada en el y en el perfil:
          // el siguiente checkout vuelve a partir del perfil.
          borradorEntrega: Prisma.DbNull,
          ...PedidosService.direccionParaPerfil(metodoEntrega, dto.direccion),
        },
      });

      // Word 5, regla 5: se emite justo cuando el conteo pasa a ser 1.
      await this.cupones.maybeIssueSecondPurchase(clienteActualizado, tx);

      // Cierre de esa misma regla: el cupon de Segunda Compra solo vale para
      // ese segundo pedido. Si el cliente lo hace sin aplicarlo, deja de
      // corresponder, igual que WELCOME tras la primera compra; si lo aplico,
      // ya quedo en USED y este filtro no lo toca.
      if (clienteActualizado.pedidos >= 2) {
        const retirados = await tx.cuponEmitido.updateMany({
          where: { clienteId, sourceCode: 'SECOND_PURCHASE', status: EstadoCupon.ACTIVE },
          data: { status: EstadoCupon.CANCELLED },
        });
        if (retirados.count > 0) {
          this.logger.log(`SECOND_PURCHASE cancelado para ${clienteId} tras su segunda compra`);
        }
      }

      await this.cashback.recalcularNivel(tx, clienteId, clienteActualizado.totalGastado);

      // Nace con sus dos renglones: quien lo creo y cuando, en cada eje.
      const creador = {
        actor: ActorBitacora.CLIENTE,
        actorId: clienteId,
        actorNombre: comprador.nombre,
      };
      await registrarEnBitacora(
        tx,
        pedido.id,
        { eje: EjeBitacora.PEDIDO, estadoAnterior: null, estadoNuevo: EstadoPedido.CONFIRMADO },
        creador,
      );
      await registrarEnBitacora(
        tx,
        pedido.id,
        { eje: EjeBitacora.PAGO, estadoAnterior: null, estadoNuevo: estadoPago },
        creador,
      );

      // El cashback queda congelado en el pedido y entra a la billetera cuando
      // se paga. Cubierto con la billetera ya nace pagado: se acredita ahora.
      if (estadoPago === EstadoPago.PAGADO) {
        await this.cashback.acreditarPedido(tx, pedido.id);
      }

      return this.aDto(
        await tx.pedido.findUniqueOrThrow({
          where: { id: pedido.id },
          include: { items: true, cupon: true },
        }),
      );
    });
  }

  /**
   * Convierte un prospecto en cliente. Es el unico sitio donde nace un cliente
   * que no venia ya de la base: se es cliente al comprar, no al registrarse.
   *
   * Tres pasos, todos dentro de la transaccion del pedido:
   *
   *  1. Se crea el `Cliente` con lo que el prospecto ya habia escrito, incluida
   *     la direccion y la fuente de adquisicion: la atribucion es del registro,
   *     no de la compra. **Con el mismo id**, que es lo que hace que el token
   *     que el navegador ya tiene siga valiendo despues de comprar: `sub` no
   *     cambia y nadie tiene que volver a entrar.
   *  2. Sus cupones cambian de dueno. El de bienvenida pasa a `clienteId` justo
   *     a tiempo de gastarse en este mismo pedido.
   *  3. Se borra la fila de `prospectos`, para que un telefono nunca este en
   *     las dos tablas.
   */
  private async convertir(tx: Prisma.TransactionClient, prospecto: Prospecto): Promise<Cliente> {
    const cliente = await tx.cliente.create({
      data: {
        id: prospecto.id,
        nombre: prospecto.nombre,
        telefono: prospecto.telefono,
        email: prospecto.email,
        fechaNacimiento: prospecto.fechaNacimiento,
        quienRecibe: prospecto.quienRecibe,
        sucursal: prospecto.sucursal,
        calle: prospecto.calle,
        colonia: prospecto.colonia,
        cp: prospecto.cp,
        ciudad: prospecto.ciudad,
        estado: prospecto.estado,
        referencias: prospecto.referencias,
        lat: prospecto.lat,
        lng: prospecto.lng,
        notificaciones: prospecto.notificaciones,
        fuenteCodigo: prospecto.fuenteCodigo,
        // El carrito guardado viaja con lo demas. En este pedido concreto se
        // vaciara enseguida, pero la copia se hace igual: si manana la
        // conversion deja de coincidir con "acaba de comprar", el carrito no se
        // pierde por haberlo dado por supuesto aqui.
        carrito: prospecto.carrito ?? Prisma.DbNull,
        carritoEn: prospecto.carritoEn,
        borradorEntrega: prospecto.borradorEntrega ?? Prisma.DbNull,
      },
    });

    await tx.cuponEmitido.updateMany({
      where: { prospectoId: prospecto.id },
      data: { clienteId: cliente.id, prospectoId: null },
    });

    await tx.prospecto.delete({ where: { id: prospecto.id } });

    this.logger.log(`Prospecto ${prospecto.id} convertido en cliente ${cliente.id}`);
    return cliente;
  }

  /**
   * La direccion que se congela en el pedido (HU-11).
   *
   * Es una copia de lo que mando el checkout, nunca una lectura del perfil: el
   * cliente pudo editarla solo para este pedido, y logistica —y el orden de
   * rutas por `lat`/`lng`— tiene que seguir viendola igual aunque el perfil
   * cambie despues. Recoger en tienda no lleva direccion: se guarda `{}`.
   */
  private static copiaDireccion(
    metodoEntrega: MetodoEntrega,
    direccion: DireccionEntregaDto | undefined,
  ): Prisma.InputJsonObject {
    if (metodoEntrega !== MetodoEntrega.DOMICILIO || !direccion) return {};
    const texto = (valor: string | null | undefined): string | null => valor?.trim() || null;
    return {
      quienRecibe: direccion.quienRecibe.trim(),
      telefono: direccion.telefono,
      calle: direccion.calle.trim(),
      colonia: direccion.colonia.trim(),
      cp: direccion.cp,
      ciudad: direccion.ciudad.trim(),
      estado: texto(direccion.estado),
      referencias: texto(direccion.referencias),
      lat: direccion.lat ?? null,
      lng: direccion.lng ?? null,
    };
  }

  /**
   * La direccion de cada pedido a domicilio pasa a ser la del perfil.
   *
   * El checkout parte de la del perfil; si el cliente la cambia para comprar,
   * esa es donde vive ahora y es la que tiene que ver en Mi Perfil y en el
   * siguiente pedido. Por eso se pisa aunque ya hubiera una guardada. El
   * telefono no se copia: el del perfil es el de login.
   */
  private static direccionParaPerfil(
    metodoEntrega: MetodoEntrega,
    direccion: DireccionEntregaDto | undefined,
  ): Prisma.ClienteUpdateInput {
    if (metodoEntrega !== MetodoEntrega.DOMICILIO || !direccion) return {};
    const texto = (valor: string | null | undefined): string | null => valor?.trim() || null;
    return {
      quienRecibe: direccion.quienRecibe.trim(),
      calle: direccion.calle.trim(),
      colonia: direccion.colonia.trim(),
      cp: direccion.cp,
      ciudad: direccion.ciudad.trim(),
      estado: texto(direccion.estado),
      referencias: texto(direccion.referencias),
      lat: direccion.lat ?? null,
      lng: direccion.lng ?? null,
    };
  }

  /**
   * Folio legible y sin colisiones, servido por una secuencia de Postgres. Va sin guion
   * porque es la referencia de la transferencia y algunos bancos no aceptan guiones.
   */
  private static async siguienteFolio(tx: Prisma.TransactionClient): Promise<string> {
    const filas = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('pedidos_folio_seq')`;
    return `ORD${String(filas[0].nextval).padStart(6, '0')}`;
  }

  // ----------------------------------------------------------------
  // Consulta
  // ----------------------------------------------------------------

  async misPedidos(clienteId: string): Promise<PedidoDto[]> {
    const pedidos = await this.prisma.pedido.findMany({
      where: { clienteId },
      orderBy: { creadoEn: 'desc' },
      include: { items: true, cupon: true },
    });
    return pedidos.map((p) => this.aDto(p));
  }

  /**
   * El ultimo pedido del cliente, valorado a precio de hoy (HU-04).
   *
   * `null` cuando todavia no ha comprado —o cuando quien pregunta es un
   * prospecto, que por definicion no tiene pedidos—: la Tienda simplemente no
   * pinta el bloque de repetir compra.
   *
   * Los cancelados no cuentan: proponer repetir un pedido que se cancelo es
   * proponer justo lo que no llego a pasar.
   */
  async ultimoPedido(clienteId: string): Promise<UltimoPedidoDto | null> {
    const pedido = await this.prisma.pedido.findFirst({
      where: { clienteId, estadoPago: { not: EstadoPago.CANCELADO } },
      orderBy: { creadoEn: 'desc' },
      include: { items: true },
    });
    if (!pedido) return null;

    const productos = await this.prisma.producto.findMany({
      where: { id: { in: pedido.items.map((i) => i.productoId) }, eliminadoEn: null },
      select: {
        id: true,
        nombre: true,
        unidad: true,
        precioVenta: true,
        piso2: true,
        precio2: true,
        piso3: true,
        precio3: true,
        agotado: true,
      },
    });
    const porId = new Map(productos.map((p) => [p.id, p]));

    const avisos: string[] = [];
    let subtotal = new Decimal(0);

    const items = pedido.items.map((item) => {
      const producto = porId.get(item.productoId);
      // El nombre y la unidad se toman del snapshot del pedido cuando el
      // producto ya no existe: el cliente tiene que poder leer que era lo que
      // no se le puede volver a servir.
      const disponible = producto !== undefined && !producto.agotado;
      // A precio escalonado de hoy y con la cantidad de entonces: es lo que
      // cobraria el carrito si lo repite tal cual.
      const precioHoy = producto ? precioUnitario(producto, item.cantidad) : item.precioUnitario;

      if (!producto) {
        avisos.push(`${item.nombre} ya no está en el catálogo.`);
      } else if (producto.agotado) {
        avisos.push(`${producto.nombre} está agotado ahora mismo.`);
      }

      const importe = precioHoy.mul(item.cantidad);
      if (disponible) subtotal = subtotal.add(importe);

      return {
        productoId: item.productoId,
        nombre: producto?.nombre ?? item.nombre,
        unidad: producto?.unidad ?? item.unidad,
        cantidad: item.cantidad,
        precioUnitario: precioHoy.toNumber(),
        importe: importe.toNumber(),
        precioAnterior: item.precioUnitario.toNumber(),
        disponible,
      };
    });

    return {
      folio: pedido.folio,
      creadoEn: pedido.creadoEn.toISOString(),
      direccion: PedidosService.direccionLeida(pedido.direccion),
      items,
      subtotal: subtotal.toNumber(),
      avisos,
    };
  }

  /** Un pedido con el nombre del cliente, como lo ve el personal. */
  async detalle(id: string): Promise<PedidoDto> {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id },
      include: { items: true, cupon: true, cliente: { select: { nombre: true } } },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    return { ...this.aDto(pedido), clienteNombre: pedido.cliente.nombre };
  }

  /** Recogido en tienda se guarda `{}`: para quien lo lee es "sin direccion". */
  private static direccionLeida(direccion: Prisma.JsonValue): Record<string, unknown> | null {
    return direccion && typeof direccion === 'object' && Object.keys(direccion).length > 0
      ? (direccion as Record<string, unknown>)
      : null;
  }

  /**
   * Pedidos con el nombre del cliente, para las pantallas del personal. Cada
   * seccion pone su filtro y su orden; el formato es el mismo para todas.
   */
  async buscar(
    where: Prisma.PedidoWhereInput,
    orderBy: Prisma.PedidoOrderByWithRelationInput,
    limite: number,
  ): Promise<PedidoDto[]> {
    const pedidos = await this.prisma.pedido.findMany({
      where,
      orderBy,
      take: limite,
      include: { items: true, cupon: true, cliente: { select: { nombre: true } } },
    });
    return pedidos.map((p) => ({ ...this.aDto(p), clienteNombre: p.cliente.nombre }));
  }

  /** Historial completo para Administracion. */
  async todos(limite = 100): Promise<PedidoDto[]> {
    const pedidos = await this.prisma.pedido.findMany({
      orderBy: { creadoEn: 'desc' },
      take: limite,
      include: { items: true, cupon: true, cliente: { select: { nombre: true } } },
    });
    return pedidos.map((p) => ({ ...this.aDto(p), clienteNombre: p.cliente.nombre }));
  }

  private aDto(
    pedido: Pedido & {
      items: {
        productoId: string;
        nombre: string;
        categoria: string;
        unidad: string;
        precioUnitario: Decimal;
        cantidad: number;
      }[];
      cupon?: { code: string; title: string } | null;
    },
  ): PedidoDto {
    return {
      id: pedido.id,
      folio: pedido.folio,
      clienteId: pedido.clienteId,
      subtotal: pedido.subtotal.toNumber(),
      envio: pedido.envio.toNumber(),
      recargoFuera: pedido.recargoFuera.toNumber(),
      descuento: pedido.descuento.toNumber(),
      total: pedido.total.toNumber(),
      cashbackGenerado: pedido.cashbackGenerado.toNumber(),
      cashbackAcreditado: pedido.cashbackAcreditadoEn !== null,
      estado: pedido.estado,
      pago: {
        metodo: pedido.metodoPago,
        estado: pedido.estadoPago,
        billetera: pedido.pagadoConBilletera.toNumber(),
        aPagar: pedido.total.sub(pedido.pagadoConBilletera).toNumber(),
        pagoCon: pedido.pagoCon?.toNumber() ?? null,
        cambio: pedido.cambio?.toNumber() ?? null,
        referencia: pedido.folio,
      },
      metodoEntrega: pedido.metodoEntrega,
      direccion: PedidosService.direccionLeida(pedido.direccion),
      cupon: pedido.cupon ? { code: pedido.cupon.code, titulo: pedido.cupon.title } : null,
      items: pedido.items.map((i) => ({
        productoId: i.productoId,
        nombre: i.nombre,
        categoria: i.categoria,
        unidad: i.unidad,
        precioUnitario: i.precioUnitario.toNumber(),
        cantidad: i.cantidad,
        importe: i.precioUnitario.mul(i.cantidad).toNumber(),
      })),
      creadoEn: pedido.creadoEn.toISOString(),
    };
  }
}
