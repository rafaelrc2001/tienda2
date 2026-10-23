import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EstadoFactura, MetodoPago, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { diaEn, zonaDelNegocio } from '../ingresos/rango-de-fechas';
import { AbrirPeriodoDto, NuevoMovimientoDto } from './dto/bancos.dto';
import { diaDentroDelMes, encadenarSaldos, Mes, mesDelDia, mesSiguiente, Saldos } from './saldos';

const Decimal = Prisma.Decimal;

export interface CuentaBancoDto {
  id: string;
  banco: string;
  numeroCuenta: string;
  titular: string;
}

export interface ResumenPeriodoDto extends Mes {
  id: string;
  saldoInicial: number;
  saldoFinal: number;
  movimientos: number;
}

/** Una cuenta con sus periodos y lo que tocaria abrir despues. */
export interface EstadoCuentaDto {
  cuenta: CuentaBancoDto;
  /** Del mas reciente al mas viejo. */
  periodos: ResumenPeriodoDto[];
  /**
   * El mes que se propone abrir (el que sigue al ultimo) y con que saldo.
   * `saldoInicial` en null es que la cuenta no tiene periodos y hay que
   * escribirlo. Solo es la propuesta: se puede abrir cualquier otro mes.
   */
  siguiente: Mes & { saldoInicial: number | null };
}

export interface MovimientoBancarioDto {
  id: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
  factura: string | null;
  cantidad: number;
  metodo: MetodoPago;
  referencia: string | null;
  /** La factura global timbrada que lo cubre, para abrir su PDF. */
  facturaGlobalId: string | null;
}

export interface PeriodoBancarioDto extends Mes {
  id: string;
  cuentaId: string;
  saldoInicial: number;
  /** Si el inicial se escribio al abrir el mes; si no, es el final del anterior. */
  saldoInicialEscrito: boolean;
  /** El inicial mas todos los movimientos del mes. */
  saldo: number;
  /** Por fecha y, el mismo dia, en el orden en que se capturaron. */
  movimientos: MovimientoBancarioDto[];
}

/**
 * Finanzas -> Bancos: el estado de cuenta de cada cuenta bancaria, por meses.
 *
 * Los saldos no se guardan (salvo el inicial escrito al abrir un mes): se
 * encadenan en vivo con `encadenarSaldos`, asi corregir un mes viejo corrige
 * los que le siguen. Toda la aritmetica la hace la API; la interfaz
 * solo pinta.
 */
@Injectable()
export class BancosService {
  constructor(private readonly prisma: PrismaService) {}

  /** Las cuentas dadas de alta en Configuracion, para elegir una. */
  async listarCuentas(): Promise<CuentaBancoDto[]> {
    const cuentas = await this.prisma.cuentaBancaria.findMany({ orderBy: { creadoEn: 'asc' } });
    return cuentas.map(aCuentaDto);
  }

  async estadoDeCuenta(cuentaId: string): Promise<EstadoCuentaDto> {
    const cuenta = await this.prisma.cuentaBancaria.findUnique({ where: { id: cuentaId } });
    if (!cuenta) throw new NotFoundException('La cuenta bancaria no existe');

    const { periodos, saldos } = await this.saldosDeLaCuenta(this.prisma, cuentaId);
    const conteos = await this.prisma.movimientoBancario.groupBy({
      by: ['periodoId'],
      where: { periodo: { cuentaId } },
      _count: { _all: true },
    });
    const cuantos = new Map(conteos.map((c) => [c.periodoId, c._count._all]));

    const ultimo = periodos.at(-1);
    const siguiente = ultimo
      ? { ...mesSiguiente(ultimo), saldoInicial: saldos.get(ultimo.id)!.final.toNumber() }
      : { ...mesDelDia(diaEn(new Date(), zonaDelNegocio())), saldoInicial: null };

    return {
      cuenta: aCuentaDto(cuenta),
      periodos: [...periodos].reverse().map((p) => ({
        id: p.id,
        anio: p.anio,
        mes: p.mes,
        saldoInicial: saldos.get(p.id)!.inicial.toNumber(),
        saldoFinal: saldos.get(p.id)!.final.toNumber(),
        movimientos: cuantos.get(p.id) ?? 0,
      })),
      siguiente,
    };
  }

  /**
   * Abre cualquier mes de una cuenta, antes, en medio o despues de los que ya
   * hay. Con saldo inicial escrito, el mes empieza en el; sin el, hereda el
   * final del periodo anterior, y si no hay ninguno antes se exige. Un mes
   * abierto antes del primero no mueve a los demas: el que era primero
   * conserva su saldo escrito.
   */
  async abrirPeriodo(
    cuentaId: string,
    dto: AbrirPeriodoDto,
    usuarioId: string,
  ): Promise<PeriodoBancarioDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      const cuenta = await tx.cuentaBancaria.findUnique({ where: { id: cuentaId } });
      if (!cuenta) throw new NotFoundException('La cuenta bancaria no existe');

      if (dto.saldoInicial === undefined) {
        const anterior = await tx.periodoBancario.findFirst({
          where: {
            cuentaId,
            OR: [{ anio: { lt: dto.anio } }, { anio: dto.anio, mes: { lt: dto.mes } }],
          },
          select: { id: true },
        });
        if (!anterior) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'SALDO_INICIAL_REQUERIDO',
            message: `No hay un periodo antes de ${nombreMes(dto)}: escribe su saldo inicial.`,
          });
        }
      }

      try {
        const periodo = await tx.periodoBancario.create({
          data: {
            cuentaId,
            anio: dto.anio,
            mes: dto.mes,
            saldoApertura: dto.saldoInicial === undefined ? null : new Decimal(dto.saldoInicial),
            abiertoPorId: usuarioId,
          },
        });
        return periodo.id;
      } catch (fallo) {
        // Dos personas abriendo el mismo mes a la vez: gana la primera.
        if (fallo instanceof Prisma.PrismaClientKnownRequestError && fallo.code === 'P2002') {
          throw new ConflictException({
            statusCode: 409,
            code: 'PERIODO_YA_ABIERTO',
            message: `${nombreMes(dto)} ya está abierto en esta cuenta.`,
          });
        }
        throw fallo;
      }
    });
    return this.verPeriodo(id);
  }

  async verPeriodo(periodoId: string): Promise<PeriodoBancarioDto> {
    const periodo = await this.prisma.periodoBancario.findUnique({
      where: { id: periodoId },
      include: {
        movimientos: {
          orderBy: [{ fecha: 'asc' }, { creadoEn: 'asc' }],
          include: { facturaGlobal: { select: { estado: true } } },
        },
      },
    });
    if (!periodo) throw new NotFoundException('El periodo no existe');

    const { saldos } = await this.saldosDeLaCuenta(this.prisma, periodo.cuentaId);
    const { inicial, final }: Saldos = saldos.get(periodo.id)!;

    return {
      id: periodo.id,
      cuentaId: periodo.cuentaId,
      anio: periodo.anio,
      mes: periodo.mes,
      saldoInicial: inicial.toNumber(),
      saldoInicialEscrito: periodo.saldoApertura !== null,
      saldo: final.toNumber(),
      movimientos: periodo.movimientos.map((m) => ({
        id: m.id,
        fecha: m.fecha.toISOString().slice(0, 10),
        factura: m.factura,
        cantidad: m.cantidad.toNumber(),
        metodo: m.metodo,
        referencia: m.referencia,
        // Mientras se timbra no hay PDF que abrir.
        facturaGlobalId:
          m.facturaGlobal?.estado === EstadoFactura.TIMBRADA ? m.facturaGlobalId : null,
      })),
    };
  }

  async agregarMovimiento(
    periodoId: string,
    dto: NuevoMovimientoDto,
    usuarioId: string,
  ): Promise<PeriodoBancarioDto> {
    const periodo = await this.prisma.periodoBancario.findUnique({ where: { id: periodoId } });
    if (!periodo) throw new NotFoundException('El periodo no existe');

    if (!diaDentroDelMes(dto.fecha, periodo)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'FECHA_FUERA_DEL_PERIODO',
        message: `La fecha tiene que ser un día de ${nombreMes(periodo)}.`,
      });
    }

    await this.prisma.movimientoBancario.create({
      data: {
        periodoId,
        // Un `@db.Date`: la medianoche UTC del dia, sin zona que lo mueva.
        fecha: new Date(`${dto.fecha}T00:00:00Z`),
        factura: dto.factura ?? null,
        cantidad: new Decimal(dto.cantidad),
        metodo: dto.metodo,
        referencia: dto.referencia ?? null,
        registradoPorId: usuarioId,
      },
    });
    return this.verPeriodo(periodoId);
  }

  /** Quitar un renglon capturado por error. Devuelve el periodo como queda. */
  async eliminarMovimiento(movimientoId: string): Promise<PeriodoBancarioDto> {
    const movimiento = await this.prisma.movimientoBancario.findUnique({
      where: { id: movimientoId },
    });
    if (!movimiento) throw new NotFoundException('El movimiento no existe');
    // Un deposito dentro de una factura global ya timbrada (o timbrandose) se
    // queda: borrarlo dejaria un CFDI que no se sabe que cubre.
    if (movimiento.facturaGlobalId) {
      throw new ConflictException({
        statusCode: 409,
        code: 'MOVIMIENTO_FACTURADO',
        message: 'Este movimiento está en una factura global: no se puede eliminar.',
      });
    }
    await this.prisma.movimientoBancario.delete({ where: { id: movimientoId } });
    return this.verPeriodo(movimiento.periodoId);
  }

  /** Los periodos de una cuenta, del mas viejo al mas nuevo, con sus saldos. */
  private async saldosDeLaCuenta(
    db: Prisma.TransactionClient,
    cuentaId: string,
  ): Promise<{
    periodos: { id: string; anio: number; mes: number; saldoApertura: Prisma.Decimal | null }[];
    saldos: Map<string, Saldos>;
  }> {
    const [periodos, sumas] = await Promise.all([
      db.periodoBancario.findMany({
        where: { cuentaId },
        orderBy: [{ anio: 'asc' }, { mes: 'asc' }],
        select: { id: true, anio: true, mes: true, saldoApertura: true },
      }),
      db.movimientoBancario.groupBy({
        by: ['periodoId'],
        where: { periodo: { cuentaId } },
        _sum: { cantidad: true },
      }),
    ]);
    const porPeriodo = new Map(sumas.map((s) => [s.periodoId, s._sum.cantidad ?? new Decimal(0)]));
    return { periodos, saldos: encadenarSaldos(periodos, porPeriodo) };
  }
}

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function nombreMes({ anio, mes }: Mes): string {
  return `${MESES[mes - 1]} de ${anio}`;
}

function aCuentaDto(c: CuentaBancoDto): CuentaBancoDto {
  return { id: c.id, banco: c.banco, numeroCuenta: c.numeroCuenta, titular: c.titular };
}
