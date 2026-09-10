import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cliente, EstadoCupon, EstadoPedido, Pedido, Prisma, Prospecto } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { CuponesService } from '../cupones/cupones.service';
import { CashbackService } from '../cashback/cashback.service';
import { precioUnitario } from '../catalogo/precios';
import { CarritoService } from './carrito.service';
import { InventarioService } from '../inventario/inventario.service';
import { CrearPedidoDto } from './dto/carrito.dto';

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
  estado: string;
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
        const validacion = await this.carrito.exigirCuponValido(
          duenioId,
          dto.codigoCupon,
          carrito,
        );

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

      // Mismo calculo que devuelve POST /carrito/previsualizar.
      const desglose = CarritoService.calcularCarrito(
        carrito,
        config,
        dentroDeHorario,
        porcentajeCashback,
        descuento,
      );
      const { envio, recargoFuera, total } = desglose;

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
          estado: 'CONFIRMADO',
          direccion: {
            calle: comprador.calle,
            colonia: comprador.colonia,
            cp: comprador.cp,
            ciudad: comprador.ciudad,
            estado: comprador.estado,
            referencias: comprador.referencias,
            lat: comprador.lat,
            lng: comprador.lng,
            quienRecibe: comprador.quienRecibe,
          },
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

      // Cashback y nivel, dentro de la misma transaccion: si el pedido no se
      // guarda, tampoco se acredita saldo. Hoy todo va a la billetera (HU-19),
      // asi que se acredita con el multiplicador ya aplicado.
      const cashbackGenerado = desglose.cashbackBilletera;
      await this.cashback.acreditarPorPedido(
        tx,
        clienteId,
        pedido.id,
        folio,
        cashbackGenerado,
        clienteActualizado.totalGastado,
      );

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

  /** Folio legible y sin colisiones, servido por una secuencia de Postgres. */
  private static async siguienteFolio(tx: Prisma.TransactionClient): Promise<string> {
    const filas = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('pedidos_folio_seq')`;
    return `ORD-${String(filas[0].nextval).padStart(6, '0')}`;
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
      where: { clienteId, estado: { not: EstadoPedido.CANCELADO } },
      orderBy: { creadoEn: 'desc' },
      include: { items: true },
    });
    if (!pedido) return null;

    const productos = await this.prisma.producto.findMany({
      where: { id: { in: pedido.items.map((i) => i.productoId) } },
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
      direccion:
        pedido.direccion && typeof pedido.direccion === 'object'
          ? (pedido.direccion as Record<string, unknown>)
          : null,
      items,
      subtotal: subtotal.toNumber(),
      avisos,
    };
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
      estado: pedido.estado,
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
