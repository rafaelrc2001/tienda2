import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EstadoCupon, Pedido, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { CuponesService } from '../cupones/cupones.service';
import { CashbackService } from '../cashback/cashback.service';
import { CarritoService } from './carrito.service';
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

@Injectable()
export class PedidosService {
  private readonly logger = new Logger(PedidosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly carrito: CarritoService,
    private readonly configuracion: ConfiguracionService,
    private readonly cupones: CuponesService,
    private readonly cashback: CashbackService,
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
   *  4. Crear el pedido y sus lineas.
   *  5. Marcar el cupon como USED.
   *  6. Cancelar el WELCOME sobrante.
   *  7. Actualizar los contadores del cliente.
   *  8. Emitir el cupon de segunda compra si corresponde.
   */
  async crear(clienteId: string, dto: CrearPedidoDto): Promise<PedidoDto> {
    const cliente = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');
    if (!cliente.nombre?.trim()) {
      throw new ConflictException('Completa tu nombre en Mi Perfil antes de pedir.');
    }

    const config = await this.configuracion.obtener();
    const dentroDeHorario = ConfiguracionService.estaDentroDeHorario(config);
    if (!dentroDeHorario && !config.atenderFuera) {
      throw new ConflictException(
        `Ahora mismo no estamos recibiendo pedidos. Nuestro horario es de ${config.abre} a ${config.cierra}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const carrito = await this.carrito.resolver(dto.items);
      const subtotal = carrito.subtotal;

      // Envio gratis segun el subtotal ANTES del descuento, igual que el
      // prototipo: el cupon no debe hacer perder el envio gratis.
      const envio = subtotal.greaterThanOrEqualTo(config.montoEnvioGratis)
        ? new Decimal(0)
        : new Decimal(config.costoEnvio);

      const recargoFuera = dentroDeHorario
        ? new Decimal(0)
        : subtotal.mul(config.incrementoFuera).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      let descuento = new Decimal(0);
      let cuponId: string | null = null;

      if (dto.codigoCupon) {
        const validacion = await this.carrito.exigirCuponValido(
          clienteId,
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

      const total = subtotal
        .add(envio)
        .add(recargoFuera)
        .sub(descuento)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      const folio = await PedidosService.siguienteFolio(tx);
      const ahora = new Date();

      const pedido = await tx.pedido.create({
        data: {
          folio,
          clienteId,
          subtotal,
          envio,
          recargoFuera,
          descuento,
          total: total.lessThan(0) ? new Decimal(0) : total,
          estado: 'CONFIRMADO',
          direccion: {
            calle: cliente.calle,
            colonia: cliente.colonia,
            cp: cliente.cp,
            ciudad: cliente.ciudad,
            estado: cliente.estado,
            referencias: cliente.referencias,
            lat: cliente.lat,
            lng: cliente.lng,
            quienRecibe: cliente.quienRecibe,
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

      const clienteActualizado = await tx.cliente.update({
        where: { id: clienteId },
        data: {
          pedidos: { increment: 1 },
          totalGastado: { increment: total },
          ultimoPedido: ahora,
          ...(cliente.primerPedido === null && { primerPedido: ahora }),
        },
      });

      // Word 5, regla 5: se emite justo cuando el conteo pasa a ser 1.
      await this.cupones.maybeIssueSecondPurchase(clienteActualizado, tx);

      // Cashback y nivel, dentro de la misma transaccion: si el pedido no se
      // guarda, tampoco se acredita saldo.
      const cashbackGenerado = CashbackService.calcular(
        subtotal,
        config.multiplicadorCashback,
        config.montoMinimoCashback,
      );
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
      items: { productoId: string; nombre: string; categoria: string; unidad: string; precioUnitario: Decimal; cantidad: number }[];
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
