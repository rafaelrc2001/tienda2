import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AfectaInventario,
  MotivoMovimiento,
  MovimientoInventario,
  Prisma,
  TipoMovimiento,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BuscarMovimientosDto, RegistrarMovimientosDto } from './dto/movimiento.dto';
import { UsuarioAutenticado } from '../auth/jwt-payload';

/** Saldo de un producto, tal como lo pinta la ventana de Inventario. */
export interface SaldoProductoDto {
  id: string;
  nombre: string;
  categoria: string;
  unidad: string;
  /** Existencia fisica en bodega. */
  inventario: number;
  /** Lo liberado para venta. */
  aptInventario: number;
  /**
   * Fisico menos apartado. Es el numero que delata un descuadre: si no hay
   * nada en cuarentena deberia ser cero.
   */
  diferencia: number;
  agotado: boolean;
}

export interface MovimientoDto {
  id: string;
  productoId: string;
  producto: string;
  tipo: TipoMovimiento;
  afecta: AfectaInventario;
  motivo: MotivoMovimiento;
  cantidad: number;
  empleado: string;
  observaciones: string | null;
  usuarioNombre: string | null;
  pedidoId: string | null;
  fisicoAntes: number;
  fisicoDespues: number;
  aptAntes: number;
  aptDespues: number;
  creadoEn: string;
}

export interface ResumenLoteDto {
  productos: number;
  piezas: number;
  movimientos: MovimientoDto[];
}

/** Lo que hace falta para aplicar un movimiento, venga de donde venga. */
interface Aplicacion {
  productoId: string;
  cantidad: number;
  tipo: TipoMovimiento;
  afecta: AfectaInventario;
  motivo: MotivoMovimiento;
  empleado: string;
  observaciones?: string | null;
  usuarioId?: string | null;
  usuarioNombre?: string | null;
  pedidoId?: string | null;
}

const LIMITE_HISTORIAL = 50;

type ProductoConCategoria = Prisma.ProductoGetPayload<{
  include: { categoria: { select: { nombre: true } } };
}>;

type MovimientoConProducto = MovimientoInventario & { producto: { nombre: string } };

/**
 * Bodega: los dos saldos de cada producto y la bitacora que los explica.
 *
 * La regla de la que cuelga todo lo demas: **aqui nadie escribe un saldo, solo
 * lo suma o lo resta**. Un SET pisaria lo que otro acaba de mover y dejaria la
 * bitacora mintiendo. Por eso no hay un "ajustar inventario a N": para corregir
 * se registra el movimiento que falta, con su motivo AJUSTE, y queda escrito.
 */
@Injectable()
export class InventarioService {
  private readonly logger = new Logger(InventarioService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------------
  // Consulta
  // ----------------------------------------------------------------

  /**
   * Saldo de todos los productos, incluidos los agotados.
   *
   * Los agotados tambien salen a proposito: un producto retirado de la Tienda
   * sigue teniendo mercancia en bodega, y si no apareciera aqui no habria
   * forma de darle salida. Los eliminados no: ya no forman parte del catalogo.
   */
  async saldos(): Promise<SaldoProductoDto[]> {
    const productos = await this.prisma.producto.findMany({
      where: { eliminadoEn: null },
      include: { categoria: { select: { nombre: true } } },
      orderBy: [{ categoria: { nombre: 'asc' } }, { nombre: 'asc' }],
    });
    return productos.map((p) => InventarioService.aSaldo(p));
  }

  /** Historial de movimientos, del mas reciente al mas viejo (M-11). */
  async historial(filtros: BuscarMovimientosDto): Promise<MovimientoDto[]> {
    const movimientos = await this.prisma.movimientoInventario.findMany({
      where: {
        ...(filtros.productoId && { productoId: filtros.productoId }),
        ...(filtros.motivo && { motivo: filtros.motivo }),
      },
      orderBy: { creadoEn: 'desc' },
      take: filtros.limite ?? LIMITE_HISTORIAL,
      include: { producto: { select: { nombre: true } } },
    });
    return movimientos.map((m) => InventarioService.aDto(m));
  }

  // ----------------------------------------------------------------
  // Registro
  // ----------------------------------------------------------------

  /**
   * Registra un lote entero (M-1, M-5).
   *
   * Todo o nada: una sola transaccion para los N renglones. Si el producto 3
   * no tiene saldo, los productos 1 y 2 tampoco se guardan. La alternativa
   * —guardar lo que alcance— dejaria al encargado adivinando cuales de sus
   * veinte renglones entraron.
   */
  async registrarLote(
    dto: RegistrarMovimientosDto,
    usuario: UsuarioAutenticado | undefined,
  ): Promise<ResumenLoteDto> {
    // VENTA no se captura a mano: esa salida la escribe el pedido al
    // confirmarse. Dejarla aqui permitiria descontar dos veces la misma venta.
    if (dto.motivo === MotivoMovimiento.VENTA) {
      throw new ConflictException(
        'El motivo «Venta» lo registra el pedido al confirmarse, no se captura a mano.',
      );
    }

    // Un mismo producto dos veces en el lote se aplicaria dos veces contra el
    // saldo, y el segundo renglon congelaria un "antes" que ya no es el de la
    // captura. Es un dedazo, no un caso de uso.
    if (InventarioService.hayRepetidos(dto.lineas.map((l) => l.productoId))) {
      throw new ConflictException('Hay un producto repetido en el lote: captúralo una sola vez.');
    }

    const movimientos = await this.prisma.$transaction(async (tx) => {
      const hechos: MovimientoConProducto[] = [];
      for (const linea of dto.lineas) {
        hechos.push(
          await this.aplicar(tx, {
            productoId: linea.productoId,
            cantidad: linea.cantidad,
            tipo: dto.tipo,
            afecta: dto.afecta,
            motivo: dto.motivo,
            empleado: dto.empleado.trim(),
            observaciones: dto.observaciones?.trim() || null,
            usuarioId: usuario?.sub ?? null,
            usuarioNombre: usuario?.nombre ?? null,
          }),
        );
      }
      return hechos;
    });

    const piezas = dto.lineas.reduce((suma, l) => suma + l.cantidad, 0);
    this.logger.log(
      `${dto.tipo} de ${piezas} pieza(s) en ${movimientos.length} producto(s) por ${dto.empleado}`,
    );
    return {
      productos: movimientos.length,
      piezas,
      movimientos: movimientos.map((m) => InventarioService.aDto(m)),
    };
  }

  /**
   * Descuenta lo vendido, dentro de la transaccion del pedido.
   *
   * Solo se llama cuando `controlInventario` esta encendido. Mientras esta
   * apagado el pedido ni consulta ni toca el saldo: es lo que permite estrenar
   * el modulo sin bloquear las ventas mientras se captura la existencia real.
   */
  async registrarVenta(
    tx: Prisma.TransactionClient,
    pedidoId: string,
    folio: string,
    lineas: { productoId: string; cantidad: number }[],
  ): Promise<void> {
    for (const linea of lineas) {
      await this.aplicar(tx, {
        productoId: linea.productoId,
        cantidad: linea.cantidad,
        tipo: TipoMovimiento.SALIDA,
        // La venta solo compromete lo liberado para venta: la mercancia sigue
        // en bodega hasta que sale fisicamente. Las devoluciones copian este
        // alcance, asi que cancelar o regresar del reparto tampoco toca el fisico.
        afecta: AfectaInventario.APT,
        motivo: MotivoMovimiento.VENTA,
        empleado: 'Venta en línea',
        observaciones: `Pedido ${folio}`,
        pedidoId,
      });
    }
  }

  /**
   * Regresa a bodega lo que un pedido se llevo, al cancelarlo.
   *
   * No se reconstruye desde las lineas del pedido sino desde **lo que de
   * verdad salio**: sus movimientos de VENTA. Un pedido hecho con el control
   * de inventario apagado no tiene ninguno, y entonces no hay nada que
   * devolver; sumar sus lineas "por si acaso" inflaria el saldo con mercancia
   * que nunca se descontó.
   *
   * Devuelve cuantas piezas volvieron, para el mensaje de quien cancela.
   */
  async devolverPedido(
    tx: Prisma.TransactionClient,
    pedidoId: string,
    folio: string,
    quien: { usuarioId: string | null; usuarioNombre: string },
  ): Promise<number> {
    const ventas = await tx.movimientoInventario.findMany({
      where: { pedidoId, motivo: MotivoMovimiento.VENTA, tipo: TipoMovimiento.SALIDA },
      select: { productoId: true, cantidad: true, afecta: true },
    });

    let piezas = 0;
    for (const venta of ventas) {
      await this.aplicar(tx, {
        productoId: venta.productoId,
        cantidad: venta.cantidad,
        tipo: TipoMovimiento.ENTRADA,
        // Se deshace exactamente lo que se hizo, con el mismo alcance.
        afecta: venta.afecta,
        motivo: MotivoMovimiento.DEVOLUCION,
        empleado: quien.usuarioNombre,
        observaciones: `Cancelación del pedido ${folio}`,
        usuarioId: quien.usuarioId,
        usuarioNombre: quien.usuarioNombre,
        pedidoId,
      });
      piezas += venta.cantidad;
    }
    return piezas;
  }

  /**
   * Regresa a bodega lo que el camion no entrego, al cerrar el corte.
   *
   * A diferencia de `devolverPedido()`, aqui la devolucion es **parcial**: el
   * cliente pudo quedarse con parte del renglon. Por eso las cantidades llegan
   * contadas desde la carga del repartidor en vez de deducirse del pedido.
   *
   * Lo que si se conserva es el principio: nunca entra mas de lo que salio. Se
   * comprueba contra los movimientos de VENTA del pedido, asi que un pedido
   * hecho con el control de inventario apagado —que no tiene ninguno— no
   * devuelve nada, y devolver dos veces el mismo renglon tampoco infla el
   * saldo.
   *
   * Devuelve cuantas piezas volvieron, para el resumen del corte.
   */
  async devolverDeRuta(
    tx: Prisma.TransactionClient,
    pedidoId: string,
    folio: string,
    lineas: { productoId: string; cantidad: number }[],
    quien: { usuarioId: string | null; usuarioNombre: string },
  ): Promise<number> {
    const movimientos = await tx.movimientoInventario.findMany({
      where: { pedidoId, motivo: { in: [MotivoMovimiento.VENTA, MotivoMovimiento.DEVOLUCION] } },
      select: { productoId: true, cantidad: true, afecta: true, tipo: true },
    });

    // Lo que sigue fuera de bodega por este pedido: lo que salio menos lo que
    // ya volvio.
    const fuera = new Map<string, { piezas: number; afecta: AfectaInventario }>();
    for (const m of movimientos) {
      const signo = m.tipo === TipoMovimiento.SALIDA ? 1 : -1;
      const actual = fuera.get(m.productoId);
      fuera.set(m.productoId, {
        piezas: (actual?.piezas ?? 0) + signo * m.cantidad,
        afecta: actual?.afecta ?? m.afecta,
      });
    }

    let piezas = 0;
    for (const linea of lineas) {
      const pendiente = fuera.get(linea.productoId);
      const cantidad = Math.min(linea.cantidad, pendiente?.piezas ?? 0);
      if (cantidad <= 0) continue;

      await this.aplicar(tx, {
        productoId: linea.productoId,
        cantidad,
        tipo: TipoMovimiento.ENTRADA,
        // Se deshace con el mismo alcance con el que se hizo la venta.
        afecta: pendiente!.afecta,
        motivo: MotivoMovimiento.DEVOLUCION,
        empleado: quien.usuarioNombre,
        observaciones: `Regresó del reparto del pedido ${folio}`,
        usuarioId: quien.usuarioId,
        usuarioNombre: quien.usuarioNombre,
        pedidoId,
      });
      fuera.set(linea.productoId, { ...pendiente!, piezas: pendiente!.piezas - cantidad });
      piezas += cantidad;
    }
    return piezas;
  }

  /**
   * Aplica **un** movimiento y deja su renglon. Es el unico sitio donde
   * cambian `inventario` y `aptInventario`.
   *
   * La condicion de saldo viaja dentro del `WHERE` del propio `UPDATE`, no en
   * un `SELECT` previo: Postgres serializa los UPDATE sobre la misma fila, asi
   * que dos salidas simultaneas del mismo producto no pueden dejar el saldo en
   * negativo. Si la fila no cumplia la condicion no se actualizo ninguna
   * (`P2025`), y eso significa que no alcanzaba.
   */
  private async aplicar(
    tx: Prisma.TransactionClient,
    a: Aplicacion,
  ): Promise<MovimientoConProducto> {
    const producto = await tx.producto.findFirst({
      where: { id: a.productoId, eliminadoEn: null },
      select: { id: true, nombre: true, inventario: true, aptInventario: true },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');

    const signo = a.tipo === TipoMovimiento.SALIDA ? -1 : 1;
    const deltaFisico = a.afecta === AfectaInventario.APT ? 0 : signo * a.cantidad;
    const deltaApt = a.afecta === AfectaInventario.FISICO ? 0 : signo * a.cantidad;

    // Solo las salidas necesitan guardia: una entrada nunca deja negativo.
    // El tipo se acota a los dos saldos a proposito: un `ProductoWhereInput`
    // entero traeria tambien `id`, y al mezclarlo con el de abajo `update`
    // dejaria de ver una clave unica.
    const guardia: { inventario?: Prisma.IntFilter; aptInventario?: Prisma.IntFilter } = {};
    if (deltaFisico < 0) guardia.inventario = { gte: -deltaFisico };
    if (deltaApt < 0) guardia.aptInventario = { gte: -deltaApt };

    let actualizado: { inventario: number; aptInventario: number; agotado: boolean };
    try {
      actualizado = await tx.producto.update({
        where: { id: a.productoId, ...guardia },
        data: {
          ...(deltaFisico !== 0 && { inventario: { increment: deltaFisico } }),
          ...(deltaApt !== 0 && { aptInventario: { increment: deltaApt } }),
        },
        select: { inventario: true, aptInventario: true, agotado: true },
      });
    } catch (fallo) {
      if (fallo instanceof Prisma.PrismaClientKnownRequestError && fallo.code === 'P2025') {
        throw new ConflictException(
          `Saldo insuficiente de ${producto.nombre}: se quieren sacar ${a.cantidad} ` +
            `y hay ${producto.inventario} en físico / ${producto.aptInventario} apartados para venta.`,
        );
      }
      throw fallo;
    }

    // El "antes" no se consulta: se deduce de lo que acabamos de mover. Un
    // SELECT previo podria leer un saldo que otra transaccion ya cambio, y la
    // bitacora congelaria un numero que nunca fue cierto.
    const fisicoDespues = actualizado.inventario;
    const aptDespues = actualizado.aptInventario;

    await this.sincronizarAgotado(tx, a.productoId, actualizado.agotado, aptDespues, deltaApt);

    return tx.movimientoInventario.create({
      data: {
        productoId: a.productoId,
        tipo: a.tipo,
        afecta: a.afecta,
        motivo: a.motivo,
        cantidad: a.cantidad,
        empleado: a.empleado,
        observaciones: a.observaciones ?? null,
        usuarioId: a.usuarioId ?? null,
        usuarioNombre: a.usuarioNombre ?? null,
        pedidoId: a.pedidoId ?? null,
        fisicoAntes: fisicoDespues - deltaFisico,
        fisicoDespues,
        aptAntes: aptDespues - deltaApt,
        aptDespues,
      },
      include: { producto: { select: { nombre: true } } },
    });
  }

  /**
   * Enciende y apaga el interruptor de agotado siguiendo al saldo de venta.
   *
   * Quedarse sin existencia es la razon mas comun de agotarse, y esperar a que
   * alguien lo marque a mano es esperar a vender lo que no hay. Solo se toca
   * cuando el movimiento cambio el saldo de venta: una entrada a cuarentena
   * —que no libera nada— deja el interruptor como estaba, igual que el marcado
   * manual, que sigue valiendo hasta el siguiente movimiento que si mueva ese
   * saldo.
   */
  private async sincronizarAgotado(
    tx: Prisma.TransactionClient,
    productoId: string,
    agotadoActual: boolean,
    aptDespues: number,
    deltaApt: number,
  ): Promise<void> {
    if (deltaApt === 0) return;
    const agotado = aptDespues === 0;
    if (agotado === agotadoActual) return;
    await tx.producto.update({ where: { id: productoId }, data: { agotado } });
  }

  // ----------------------------------------------------------------
  // Mapeo
  // ----------------------------------------------------------------

  private static aSaldo(p: ProductoConCategoria): SaldoProductoDto {
    return {
      id: p.id,
      nombre: p.nombre,
      categoria: p.categoria.nombre,
      unidad: p.unidad,
      inventario: p.inventario,
      aptInventario: p.aptInventario,
      diferencia: p.inventario - p.aptInventario,
      agotado: p.agotado,
    };
  }

  private static aDto(m: MovimientoConProducto): MovimientoDto {
    return {
      id: m.id,
      productoId: m.productoId,
      producto: m.producto.nombre,
      tipo: m.tipo,
      afecta: m.afecta,
      motivo: m.motivo,
      cantidad: m.cantidad,
      empleado: m.empleado,
      observaciones: m.observaciones,
      usuarioNombre: m.usuarioNombre,
      pedidoId: m.pedidoId,
      fisicoAntes: m.fisicoAntes,
      fisicoDespues: m.fisicoDespues,
      aptAntes: m.aptAntes,
      aptDespues: m.aptDespues,
      creadoEn: m.creadoEn.toISOString(),
    };
  }

  private static hayRepetidos(ids: string[]): boolean {
    return new Set(ids).size !== ids.length;
  }
}
