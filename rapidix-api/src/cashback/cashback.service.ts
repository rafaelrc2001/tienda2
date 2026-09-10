import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { NivelFidelidad, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GuardarNivelDto } from './dto/nivel.dto';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export interface EstadoCashback {
  saldo: number;
  nivelActual: string | null;
  proximoNivel: string | null;
  progresoPct: number;
  montoFaltante: number;
  totalGastado: number;
  /** % de cashback que gana hoy: el de su nivel mas su bono manual. */
  porcentaje: number;
}

export interface MovimientoDto {
  id: string;
  monto: number;
  concepto: string;
  pedidoFolio: string | null;
  creadoEn: string;
}

@Injectable()
export class CashbackService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cashback base que genera una compra (HU-12).
   *
   * `base` es lo que suman, a precio escalonado, los productos con
   * `aplicaCashback`: no el subtotal. Solo cuenta si la base SUPERA el minimo
   * —con el minimo exacto no hay cashback— y se trunca a pesos enteros.
   *
   * Esto sustituye al supuesto del SPEC 01, que leia `multiplicadorCashback`
   * como porcentaje sobre el subtotal. El porcentaje sale del nivel; el
   * multiplicador es cuantas veces vale al ir a la billetera (`aBilletera`).
   */
  static calcular(base: Decimal, porcentaje: Decimal, montoMinimoCashback: Decimal): Decimal {
    if (!base.greaterThan(montoMinimoCashback)) return new Decimal(0);
    return base.mul(porcentaje).div(100).floor();
  }

  /**
   * Lo que vale el cashback base al ir a la billetera: `multiplicadorCashback`
   * veces (x2). Hoy todo va a la billetera (HU-19), asi que es lo que se
   * acredita; lo que ensenan la Tienda y el carrito es la base, sin el x2.
   */
  static aBilletera(montoBase: Decimal, multiplicadorCashback: Decimal): Decimal {
    return montoBase.mul(multiplicadorCashback).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }

  /**
   * % de cashback de quien compra: el de su nivel mas su bono manual.
   *
   * El nivel se calcula en el momento con los umbrales vigentes, no se lee de
   * `nivelId`: si el negocio cambia un umbral, el % cambia ya, sin esperar al
   * siguiente pedido. Sin id —el visitante— o sin fila en `clientes` —el
   * prospecto—, y tambien cuando no alcanza ningun umbral, vale el nivel de
   * entrada: todo el que compra gana al menos el % mas bajo.
   */
  async porcentajePara(duenioId?: string): Promise<Decimal> {
    const [niveles, cliente] = await Promise.all([
      this.prisma.nivelFidelidad.findMany({ orderBy: { orden: 'asc' } }),
      duenioId
        ? this.prisma.cliente.findUnique({
            where: { id: duenioId },
            select: { totalGastado: true, pctExtra: true },
          })
        : Promise.resolve(null),
    ]);
    const nivel =
      (cliente && CashbackService.nivelPara(niveles, cliente.totalGastado)) ?? niveles[0];
    return new Decimal(nivel?.porcentaje ?? 0).add(cliente?.pctExtra ?? 0);
  }

  /**
   * Acredita el cashback de un pedido y recalcula el nivel del cliente.
   * Se llama dentro de la transaccion del pedido: o pasa todo, o nada.
   */
  async acreditarPorPedido(
    tx: Prisma.TransactionClient,
    clienteId: string,
    pedidoId: string,
    folio: string,
    monto: Decimal,
    totalGastadoTrasPedido: Decimal,
  ): Promise<void> {
    if (monto.greaterThan(0)) {
      await tx.movimientoCashback.create({
        data: { clienteId, pedidoId, monto, concepto: `Cashback del pedido ${folio}` },
      });
      await tx.cliente.update({
        where: { id: clienteId },
        data: { saldoCashback: { increment: monto } },
      });
      await tx.pedido.update({ where: { id: pedidoId }, data: { cashbackGenerado: monto } });
    }

    const niveles = await tx.nivelFidelidad.findMany({ orderBy: { orden: 'asc' } });
    const alcanzado = CashbackService.nivelPara(niveles, totalGastadoTrasPedido);
    await tx.cliente.update({
      where: { id: clienteId },
      data: { nivelId: alcanzado?.id ?? null },
    });
  }

  /** Nivel mas alto cuyo umbral ya alcanzo el cliente. */
  static nivelPara(niveles: NivelFidelidad[], totalGastado: Decimal): NivelFidelidad | null {
    const alcanzados = niveles.filter((n) => totalGastado.greaterThanOrEqualTo(n.umbralGasto));
    if (alcanzados.length === 0) return null;
    return alcanzados.reduce((mejor, n) => (n.orden > mejor.orden ? n : mejor));
  }

  /** Tarjeta de Cashback de Mi Perfil (Word 4.7). */
  /** Lo que ve quien aun no ha comprado: todo a cero, sin nivel. */
  private static readonly SIN_CASHBACK: EstadoCashback = {
    saldo: 0,
    nivelActual: null,
    proximoNivel: null,
    progresoPct: 0,
    montoFaltante: 0,
    totalGastado: 0,
    porcentaje: 0,
  };

  async estado(clienteId: string): Promise<EstadoCashback> {
    const [cliente, niveles] = await Promise.all([
      this.prisma.cliente.findUnique({ where: { id: clienteId } }),
      this.prisma.nivelFidelidad.findMany({ orderBy: { orden: 'asc' } }),
    ]);
    // Quien todavia no ha comprado no tiene fila en `clientes`. No es un
    // error: es un cashback de cero, que es justo lo que hay que ensenarle.
    // El % si es el real: el del nivel de entrada, que es el que ganara en su
    // primera compra.
    if (!cliente) {
      if (await this.prisma.prospecto.count({ where: { id: clienteId } })) {
        return {
          ...CashbackService.SIN_CASHBACK,
          porcentaje: niveles[0]?.porcentaje.toNumber() ?? 0,
        };
      }
      throw new NotFoundException('Cliente no encontrado');
    }

    const gastado = cliente.totalGastado;
    const actual = CashbackService.nivelPara(niveles, gastado);
    const siguiente = niveles.find((n) => n.orden > (actual?.orden ?? 0)) ?? null;

    let progresoPct = 100;
    let montoFaltante = 0;
    if (siguiente) {
      const base = new Decimal(actual?.umbralGasto ?? 0);
      const tramo = new Decimal(siguiente.umbralGasto).sub(base);
      const avance = gastado.sub(base);
      progresoPct = tramo.lessThanOrEqualTo(0)
        ? 100
        : Math.min(100, Math.max(0, Math.round(avance.div(tramo).mul(100).toNumber())));
      montoFaltante = Math.max(0, new Decimal(siguiente.umbralGasto).sub(gastado).toNumber());
    }

    return {
      saldo: cliente.saldoCashback.toNumber(),
      nivelActual: actual?.nombre ?? null,
      proximoNivel: siguiente?.nombre ?? null,
      progresoPct,
      montoFaltante: Math.round(montoFaltante * 100) / 100,
      totalGastado: gastado.toNumber(),
      porcentaje: new Decimal((actual ?? niveles[0])?.porcentaje ?? 0)
        .add(cliente.pctExtra)
        .toNumber(),
    };
  }

  /** "Ver estado de cuenta" de la tarjeta de Cashback. */
  async movimientos(clienteId: string, limite = 50): Promise<MovimientoDto[]> {
    const filas = await this.prisma.movimientoCashback.findMany({
      where: { clienteId },
      orderBy: { creadoEn: 'desc' },
      take: limite,
      include: { pedido: { select: { folio: true } } },
    });
    return filas.map((m) => ({
      id: m.id,
      monto: m.monto.toNumber(),
      concepto: m.concepto,
      pedidoFolio: m.pedido?.folio ?? null,
      creadoEn: m.creadoEn.toISOString(),
    }));
  }

  // ----------------------------------------------------------------
  // Niveles (Administracion)
  // ----------------------------------------------------------------

  async listarNiveles(): Promise<NivelFidelidad[]> {
    return this.prisma.nivelFidelidad.findMany({ orderBy: { orden: 'asc' } });
  }

  async crearNivel(dto: GuardarNivelDto): Promise<NivelFidelidad> {
    await this.exigirNombreYOrdenLibres(dto);
    return this.prisma.nivelFidelidad.create({
      data: {
        nombre: dto.nombre.trim(),
        umbralGasto: dto.umbralGasto,
        orden: dto.orden,
        porcentaje: dto.porcentaje,
      },
    });
  }

  async actualizarNivel(id: string, dto: GuardarNivelDto): Promise<NivelFidelidad> {
    const nivel = await this.prisma.nivelFidelidad.findUnique({ where: { id } });
    if (!nivel) throw new NotFoundException('Nivel no encontrado');
    await this.exigirNombreYOrdenLibres(dto, id);
    return this.prisma.nivelFidelidad.update({
      where: { id },
      data: {
        nombre: dto.nombre.trim(),
        umbralGasto: dto.umbralGasto,
        orden: dto.orden,
        porcentaje: dto.porcentaje,
      },
    });
  }

  async eliminarNivel(id: string): Promise<void> {
    const nivel = await this.prisma.nivelFidelidad.findUnique({ where: { id } });
    if (!nivel) throw new NotFoundException('Nivel no encontrado');
    // Los clientes que estaban en el nivel quedan sin nivel hasta que se
    // recalcule con su proximo pedido; nadie pierde saldo por esto.
    await this.prisma.cliente.updateMany({ where: { nivelId: id }, data: { nivelId: null } });
    await this.prisma.nivelFidelidad.delete({ where: { id } });
  }

  private async exigirNombreYOrdenLibres(dto: GuardarNivelDto, idActual?: string): Promise<void> {
    const choque = await this.prisma.nivelFidelidad.findFirst({
      where: {
        id: idActual ? { not: idActual } : undefined,
        OR: [{ nombre: dto.nombre.trim() }, { orden: dto.orden }],
      },
    });
    if (choque) {
      throw new ConflictException(
        choque.orden === dto.orden
          ? `Ya existe un nivel en la posición ${dto.orden}.`
          : `Ya existe un nivel llamado "${dto.nombre}".`,
      );
    }
  }
}
