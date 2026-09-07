import { Injectable, Logger } from '@nestjs/common';
import {
  Campania,
  Cliente,
  CuponEmitido,
  EstadoCupon,
  OrigenCupon,
  Prisma,
  TipoCuponCicloVida,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Codigos fijos de los 5 tipos de ciclo de vida (Word 4.9.1). */
export const CODIGOS_CICLO_VIDA = [
  'WELCOME',
  'SECOND_PURCHASE',
  'TICKET_INCREASE',
  'INACTIVITY',
  'BIRTHDAY',
] as const;
export type CodigoCicloVida = (typeof CODIGOS_CICLO_VIDA)[number];

/** Sin I, O, 0 ni 1: se confunden al dictar un codigo por telefono. */
const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const VIGENCIA_CAMPANIA_POR_DEFECTO_DIAS = 30;

/**
 * Ventana para "una sola vez por ano" del cupon de cumpleanos.
 * Ver `maybeIssueBirthday` para por que no se compara el ano natural.
 */
const DIAS_ENTRE_CUMPLEANOS = 300;

const DIA_MS = 24 * 60 * 60 * 1000;

type Plantilla = TipoCuponCicloVida | Campania;

@Injectable()
export class CuponesService {
  private readonly logger = new Logger(CuponesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------------
  // Emision
  // ----------------------------------------------------------------

  /** Codigo corto unico visible para el cliente: RPD + 4 caracteres. */
  async generarCodigoUnico(): Promise<string> {
    for (let intento = 0; intento < 20; intento++) {
      let codigo = 'RPD';
      for (let i = 0; i < 4; i++) {
        codigo += ALFABETO_CODIGO[Math.floor(Math.random() * ALFABETO_CODIGO.length)];
      }
      const existe = await this.prisma.cuponEmitido.count({ where: { code: codigo } });
      if (existe === 0) return codigo;
    }
    // 32^4 = 1,048,576 combinaciones: 20 choques seguidos significa que el
    // espacio se agoto y hay que alargar el codigo, no reintentar mas.
    throw new Error('No se pudo generar un código de cupón único.');
  }

  /**
   * Un cliente no recibe dos veces el mismo tipo de cupon mientras el anterior
   * siga vivo o ya se haya usado (Word 5, reglas 6 y 8).
   */
  async tieneCuponActivoOUsado(clienteId: string, sourceCode: string): Promise<boolean> {
    const n = await this.prisma.cuponEmitido.count({
      where: {
        clienteId,
        sourceCode,
        status: { in: [EstadoCupon.ACTIVE, EstadoCupon.USED] },
      },
    });
    return n > 0;
  }

  /**
   * Emite un cupon individual copiando ("congelando") los valores actuales de
   * la plantilla.
   *
   * Esta es la regla 1 del Word 5: cambiar despues la configuracion del tipo
   * NO afecta a los cupones ya entregados. Por eso los importes se copian a la
   * fila en vez de leerse por relacion.
   */
  async emitir(
    plantilla: Plantilla,
    sourceKind: OrigenCupon,
    clienteId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<CuponEmitido> {
    const esCampania = sourceKind === OrigenCupon.CAMPAIGN;
    const campania = esCampania ? (plantilla as Campania) : null;
    const cicloVida = esCampania ? null : (plantilla as TipoCuponCicloVida);

    const ahora = new Date();
    let expiresAt: Date;
    if (campania?.endsAt) {
      // La campania manda: el cupon no puede sobrevivir a su campana.
      expiresAt = new Date(campania.endsAt);
      expiresAt.setHours(23, 59, 59, 999);
    } else {
      const dias = cicloVida?.validityDays ?? VIGENCIA_CAMPANIA_POR_DEFECTO_DIAS;
      expiresAt = new Date(ahora.getTime() + dias * DIA_MS);
    }

    const cupon = await tx.cuponEmitido.create({
      data: {
        code: await this.generarCodigoUnico(),
        clienteId,
        sourceKind,
        sourceCode: cicloVida?.code ?? campania!.name,
        title: plantilla.title,
        description: plantilla.description,
        customerMessage: plantilla.customerMessage,
        // --- congelados ---
        discountType: plantilla.discountType,
        discountValue: plantilla.discountValue,
        minimumOrderAmount: plantilla.minimumOrderAmount,
        maximumOrderAmount: plantilla.maximumOrderAmount,
        // ------------------
        issuedAt: ahora,
        expiresAt,
        status: EstadoCupon.ACTIVE,
      },
    });

    this.logger.log(`Cupón ${cupon.code} (${cupon.sourceCode}) emitido a ${clienteId}`);
    return cupon;
  }

  // ----------------------------------------------------------------
  // Disparadores automaticos (Word 4.9.1)
  // ----------------------------------------------------------------

  private tipo(code: CodigoCicloVida): Promise<TipoCuponCicloVida | null> {
    return this.prisma.tipoCuponCicloVida.findUnique({ where: { code } });
  }

  /** Al identificar o registrar a un cliente con 0 pedidos. */
  async maybeIssueWelcome(cliente: Cliente): Promise<CuponEmitido | null> {
    const t = await this.tipo('WELCOME');
    if (!t?.isActive) return null;
    if (cliente.pedidos > 0) return null;
    if (await this.tieneCuponActivoOUsado(cliente.id, 'WELCOME')) return null;
    return this.emitir(t, OrigenCupon.LIFECYCLE, cliente.id);
  }

  /**
   * Justo cuando el conteo de pedidos pasa a ser 1, es decir despues de
   * confirmarse el primer pedido (Word 5, regla 5).
   */
  async maybeIssueSecondPurchase(
    cliente: Cliente,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<CuponEmitido | null> {
    const t = await this.tipo('SECOND_PURCHASE');
    if (!t?.isActive) return null;
    if (cliente.pedidos !== 1) return null;
    if (await this.tieneCuponActivoOUsado(cliente.id, 'SECOND_PURCHASE')) return null;
    return this.emitir(t, OrigenCupon.LIFECYCLE, cliente.id, tx);
  }

  /**
   * Cuando pasaron mas de N dias sin comprar, o el cliente nunca ha comprado.
   * Devuelve tambien si el cliente esta inactivo, que es lo que necesita el
   * bloqueo del Recetario (paso 21).
   */
  async maybeIssueInactivity(
    cliente: Cliente,
  ): Promise<{ inactivo: boolean; cupon: CuponEmitido | null }> {
    const t = await this.tipo('INACTIVITY');
    const dias = t?.inactivityDays ?? 30;

    const inactivo =
      cliente.pedidos === 0 ||
      !cliente.ultimoPedido ||
      (Date.now() - cliente.ultimoPedido.getTime()) / DIA_MS > dias;

    if (!inactivo) return { inactivo: false, cupon: null };
    if (!t?.isActive) return { inactivo, cupon: null };
    if (await this.tieneCuponActivoOUsado(cliente.id, 'INACTIVITY')) {
      return { inactivo, cupon: null };
    }
    return { inactivo, cupon: await this.emitir(t, OrigenCupon.LIFECYCLE, cliente.id) };
  }

  /**
   * Si hoy cae dentro de una ventana de +/- N dias respecto al cumpleanos.
   *
   * Dos diferencias con el prototipo, ambas deliberadas:
   *
   * 1. La distancia se mide contra el aniversario del ano anterior, este y el
   *    siguiente, quedandose con la menor. El prototipo solo comparaba con el
   *    de este ano, asi que un cumpleanos del 31 de diciembre no disparaba el
   *    1 de enero aunque la ventana lo cubriera.
   * 2. "Una vez por ano" se comprueba con una ventana de 300 dias en vez de
   *    con el ano natural. Comparar anos naturales permitiria dos cupones con
   *    dias de diferencia justo en el cambio de ano.
   */
  async maybeIssueBirthday(cliente: Cliente): Promise<CuponEmitido | null> {
    const t = await this.tipo('BIRTHDAY');
    if (!t?.isActive || !cliente.fechaNacimiento) return null;

    const ventana = t.birthdayWindowDays ?? 3;
    if (CuponesService.diasHastaCumpleanos(cliente.fechaNacimiento) > ventana) return null;

    const reciente = await this.prisma.cuponEmitido.count({
      where: {
        clienteId: cliente.id,
        sourceCode: 'BIRTHDAY',
        issuedAt: { gte: new Date(Date.now() - DIAS_ENTRE_CUMPLEANOS * DIA_MS) },
      },
    });
    if (reciente > 0) return null;

    return this.emitir(t, OrigenCupon.LIFECYCLE, cliente.id);
  }

  /** Dias entre hoy y el aniversario mas cercano, hacia atras o hacia delante. */
  static diasHastaCumpleanos(fechaNacimiento: Date, hoy = new Date()): number {
    const inicioDia = (d: Date): number =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const hoyMs = inicioDia(hoy);

    let minimo = Number.POSITIVE_INFINITY;
    for (const anio of [hoy.getFullYear() - 1, hoy.getFullYear(), hoy.getFullYear() + 1]) {
      const aniversario = new Date(anio, fechaNacimiento.getMonth(), fechaNacimiento.getDate());
      minimo = Math.min(minimo, Math.abs(aniversario.getTime() - hoyMs) / DIA_MS);
    }
    return minimo;
  }

  /**
   * Todos los disparadores de ciclo de vida que aplican al iniciar sesion.
   * SECOND_PURCHASE no entra aqui: se dispara al confirmar un pedido.
   */
  async evaluarAlIniciarSesion(cliente: Cliente): Promise<CuponEmitido[]> {
    const emitidos: (CuponEmitido | null)[] = [];
    emitidos.push(await this.maybeIssueWelcome(cliente));
    emitidos.push((await this.maybeIssueInactivity(cliente)).cupon);
    emitidos.push(await this.maybeIssueBirthday(cliente));
    return emitidos.filter((c): c is CuponEmitido => c !== null);
  }

  // ----------------------------------------------------------------
  // Consulta
  // ----------------------------------------------------------------

  /** Cupones ACTIVE del cliente, para la pestana Cupones (Word 4.5). */
  async misCupones(clienteId: string): Promise<CuponEmitido[]> {
    return this.prisma.cuponEmitido.findMany({
      where: { clienteId, status: EstadoCupon.ACTIVE, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'asc' },
    });
  }
}
