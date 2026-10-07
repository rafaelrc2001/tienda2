import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EstadoTransferencia, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventarioService, MovimientoDeTransferencia } from '../inventario/inventario.service';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { TiendasService } from './tiendas.service';
import { BuscarTransferenciasDto, CrearTransferenciaDto } from './dto/transferencia.dto';

export interface TransferenciaDto {
  id: string;
  folio: string;
  estado: EstadoTransferencia;
  tienda: { id: string; nombre: string };
  empleado: string;
  observaciones: string | null;
  creadaPor: string | null;
  creadoEn: string;
  resueltaPor: string | null;
  resueltaEn: string | null;
  piezas: number;
  lineas: { productoId: string; producto: string; unidad: string; cantidad: number }[];
}

const INCLUIR = {
  tienda: { select: { id: true, nombre: true } },
  items: {
    include: { producto: { select: { nombre: true, unidad: true } } },
    orderBy: { producto: { nombre: 'asc' } },
  },
} satisfies Prisma.TransferenciaInclude;

type TransferenciaCompleta = Prisma.TransferenciaGetPayload<{ include: typeof INCLUIR }>;

const LIMITE = 100;

/**
 * Transferencias de bodega a una tienda.
 *
 * Siguen la logica del pedido en ruta, con la tienda en el papel del camion:
 *
 *  - **crear** es armar el pedido: la mercancia se aparta en bodega (baja el
 *    apt.) y sigue en el estante;
 *  - **aceptar** es recolectar: sale del fisico de bodega y entra al
 *    inventario de la tienda;
 *  - **cancelar**, solo antes de aceptarse, libera lo apartado.
 *
 * Cada paso bloquea la fila de la transferencia, asi que aceptar y cancelar a
 * la vez no pueden pasar los dos.
 */
@Injectable()
export class TransferenciasService {
  private readonly logger = new Logger(TransferenciasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventario: InventarioService,
    private readonly tiendas: TiendasService,
  ) {}

  /** De la mas reciente a la mas vieja. */
  async listar(filtros: BuscarTransferenciasDto): Promise<TransferenciaDto[]> {
    const transferencias = await this.prisma.transferencia.findMany({
      where: {
        ...(filtros.tiendaId && { tiendaId: filtros.tiendaId }),
        ...(filtros.estado && { estado: filtros.estado }),
      },
      include: INCLUIR,
      orderBy: { creadoEn: 'desc' },
      take: LIMITE,
    });
    return transferencias.map((t) => TransferenciasService.aDto(t));
  }

  /**
   * Todo o nada, como un lote de movimientos: si a un producto no le alcanza
   * lo liberado para venta, no se aparta ninguno ni nace la transferencia.
   */
  async crear(dto: CrearTransferenciaDto, usuario: UsuarioAutenticado): Promise<TransferenciaDto> {
    const tienda = await this.tiendas.exigir(dto.tiendaId);
    if (!tienda.activa) {
      throw new ConflictException({
        statusCode: 409,
        code: 'TIENDA_INACTIVA',
        message: `La tienda «${tienda.nombre}» está desactivada.`,
      });
    }
    if (new Set(dto.lineas.map((l) => l.productoId)).size !== dto.lineas.length) {
      throw new ConflictException(
        'Hay un producto repetido en la transferencia: captúralo una sola vez.',
      );
    }

    const creada = await this.prisma.$transaction(async (tx) => {
      const transferencia = await tx.transferencia.create({
        data: {
          folio: await TransferenciasService.siguienteFolio(tx),
          tiendaId: tienda.id,
          empleado: dto.empleado.trim(),
          observaciones: dto.observaciones?.trim() || null,
          creadaPorId: usuario.sub,
          creadaPorNombre: usuario.nombre,
          items: { create: dto.lineas.map((l) => ({ ...l })) },
        },
        include: INCLUIR,
      });
      await this.inventario.apartarTransferencia(
        tx,
        TransferenciasService.paraBitacora(transferencia, transferencia.empleado, usuario),
        dto.lineas,
      );
      return transferencia;
    });

    this.logger.log(`Transferencia ${creada.folio} a ${tienda.nombre} por ${creada.empleado}`);
    return TransferenciasService.aDto(creada);
  }

  /**
   * "Recolectar": la tienda recibe la mercancia. Sale del fisico de bodega y
   * entra a su inventario, las dos cosas o ninguna.
   */
  async aceptar(id: string, usuario: UsuarioAutenticado): Promise<TransferenciaDto> {
    const aceptada = await this.prisma.$transaction(async (tx) => {
      const transferencia = await TransferenciasService.bloquearPendiente(tx, id);
      const lineas = transferencia.items.map((i) => ({
        productoId: i.productoId,
        cantidad: i.cantidad,
      }));

      await this.inventario.sacarTransferencia(
        tx,
        // Quien la recibe es quien firma la salida de bodega.
        TransferenciasService.paraBitacora(transferencia, usuario.nombre, usuario),
        lineas,
      );
      await this.tiendas.entrar(tx, transferencia.tiendaId, lineas);

      return TransferenciasService.resolver(tx, id, EstadoTransferencia.ACEPTADA, usuario);
    });

    this.logger.log(`${aceptada.tienda.nombre} aceptó la transferencia ${aceptada.folio}`);
    return TransferenciasService.aDto(aceptada);
  }

  /** Solo mientras esta pendiente: lo aceptado ya es inventario de la tienda. */
  async cancelar(id: string, usuario: UsuarioAutenticado): Promise<TransferenciaDto> {
    const cancelada = await this.prisma.$transaction(async (tx) => {
      const transferencia = await TransferenciasService.bloquearPendiente(tx, id);
      await this.inventario.liberarTransferencia(
        tx,
        TransferenciasService.paraBitacora(transferencia, usuario.nombre, usuario),
        transferencia.items.map((i) => ({ productoId: i.productoId, cantidad: i.cantidad })),
      );
      return TransferenciasService.resolver(tx, id, EstadoTransferencia.CANCELADA, usuario);
    });
    return TransferenciasService.aDto(cancelada);
  }

  // ----------------------------------------------------------------

  /**
   * Bloquea la fila hasta el final de la transaccion y exige que siga
   * pendiente. Sin el bloqueo, dos pulsaciones de "Aceptar" sacarian dos veces
   * la mercancia de bodega.
   */
  private static async bloquearPendiente(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<TransferenciaCompleta> {
    const filas = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM transferencias WHERE id = ${id} FOR UPDATE
    `;
    if (filas.length === 0) throw new NotFoundException('Transferencia no encontrada');

    const transferencia = await tx.transferencia.findUniqueOrThrow({
      where: { id },
      include: INCLUIR,
    });
    if (transferencia.estado !== EstadoTransferencia.PENDIENTE) {
      throw new ConflictException({
        statusCode: 409,
        code: 'TRANSFERENCIA_RESUELTA',
        message:
          transferencia.estado === EstadoTransferencia.ACEPTADA
            ? `La transferencia ${transferencia.folio} ya fue aceptada.`
            : `La transferencia ${transferencia.folio} fue cancelada.`,
      });
    }
    return transferencia;
  }

  private static resolver(
    tx: Prisma.TransactionClient,
    id: string,
    estado: EstadoTransferencia,
    usuario: UsuarioAutenticado,
  ): Promise<TransferenciaCompleta> {
    return tx.transferencia.update({
      where: { id },
      data: {
        estado,
        resueltaPorId: usuario.sub,
        resueltaPorNombre: usuario.nombre,
        resueltaEn: new Date(),
      },
      include: INCLUIR,
    });
  }

  private static paraBitacora(
    transferencia: TransferenciaCompleta,
    empleado: string,
    usuario: UsuarioAutenticado,
  ): MovimientoDeTransferencia {
    return {
      id: transferencia.id,
      folio: transferencia.folio,
      tienda: transferencia.tienda.nombre,
      empleado,
      usuarioId: usuario.sub,
      usuarioNombre: usuario.nombre,
    };
  }

  /** Folio servido por una secuencia de Postgres, como el de pedidos y repartos. */
  private static async siguienteFolio(tx: Prisma.TransactionClient): Promise<string> {
    const filas = await tx.$queryRaw<
      { nextval: bigint }[]
    >`SELECT nextval('transferencias_folio_seq')`;
    return `TRA${String(filas[0].nextval).padStart(6, '0')}`;
  }

  private static aDto(t: TransferenciaCompleta): TransferenciaDto {
    return {
      id: t.id,
      folio: t.folio,
      estado: t.estado,
      tienda: t.tienda,
      empleado: t.empleado,
      observaciones: t.observaciones,
      creadaPor: t.creadaPorNombre,
      creadoEn: t.creadoEn.toISOString(),
      resueltaPor: t.resueltaPorNombre,
      resueltaEn: t.resueltaEn?.toISOString() ?? null,
      piezas: t.items.reduce((suma, i) => suma + i.cantidad, 0),
      lineas: t.items.map((i) => ({
        productoId: i.productoId,
        producto: i.producto.nombre,
        unidad: i.producto.unidad,
        cantidad: i.cantidad,
      })),
    };
  }
}
