import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoCupon, OrigenCupon, TipoDescuento } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CuponesService } from './cupones.service';
import { ActualizarCicloVidaDto } from './dto/ciclo-vida.dto';

export interface TipoCicloVidaDto {
  code: string;
  name: string;
  title: string;
  description: string;
  customerMessage: string;
  discountType: TipoDescuento;
  discountValue: number;
  minimumOrderAmount: number;
  maximumOrderAmount: number | null;
  validityDays: number;
  usageLimitPerCustomer: number;
  inactivityDays: number | null;
  birthdayWindowDays: number | null;
  isActive: boolean;
  /** Calculados en vivo desde los cupones emitidos (Word 4.9.5). */
  generados: number;
  utilizados: number;
  porcentajeUtilizacion: number;
}

@Injectable()
export class CicloVidaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cupones: CuponesService,
  ) {}

  /** Los 5 tipos con sus contadores en vivo. */
  async listar(): Promise<TipoCicloVidaDto[]> {
    const [tipos, porTipo] = await Promise.all([
      this.prisma.tipoCuponCicloVida.findMany(),
      this.prisma.cuponEmitido.groupBy({
        by: ['sourceCode', 'status'],
        where: { sourceKind: OrigenCupon.LIFECYCLE },
        _count: { _all: true },
      }),
    ]);

    const contar = (code: string, status?: EstadoCupon): number =>
      porTipo
        .filter((g) => g.sourceCode === code && (status === undefined || g.status === status))
        .reduce((suma, g) => suma + g._count._all, 0);

    // Orden fijo, el mismo en que se presentan en el panel.
    const orden = ['WELCOME', 'SECOND_PURCHASE', 'TICKET_INCREASE', 'INACTIVITY', 'BIRTHDAY'];

    return tipos
      .sort((a, b) => orden.indexOf(a.code) - orden.indexOf(b.code))
      .map((t) => {
        const generados = contar(t.code);
        const utilizados = contar(t.code, EstadoCupon.USED);
        return {
          code: t.code,
          name: t.name,
          title: t.title,
          description: t.description,
          customerMessage: t.customerMessage,
          discountType: t.discountType,
          discountValue: t.discountValue.toNumber(),
          minimumOrderAmount: t.minimumOrderAmount.toNumber(),
          maximumOrderAmount: t.maximumOrderAmount?.toNumber() ?? null,
          validityDays: t.validityDays,
          usageLimitPerCustomer: t.usageLimitPerCustomer,
          inactivityDays: t.inactivityDays,
          birthdayWindowDays: t.birthdayWindowDays,
          isActive: t.isActive,
          generados,
          utilizados,
          porcentajeUtilizacion: generados === 0 ? 0 : Math.round((utilizados / generados) * 100),
        };
      });
  }

  /**
   * Edita los parametros de un tipo. No toca los cupones ya emitidos: sus
   * importes estan congelados en su propia fila (Word 5, regla 1).
   */
  async actualizar(code: string, dto: ActualizarCicloVidaDto): Promise<TipoCicloVidaDto> {
    const tipo = await this.prisma.tipoCuponCicloVida.findUnique({ where: { code } });
    if (!tipo) throw new NotFoundException('Tipo de cupón no encontrado');

    if (code === 'INACTIVITY' && (dto.inactivityDays ?? null) === null) {
      throw new BadRequestException('El cupón de inactividad necesita los días de inactividad.');
    }
    if (code === 'BIRTHDAY' && (dto.birthdayWindowDays ?? null) === null) {
      throw new BadRequestException('El cupón de cumpleaños necesita la ventana de días.');
    }

    await this.prisma.tipoCuponCicloVida.update({
      where: { code },
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() ?? tipo.description,
        customerMessage: dto.customerMessage?.trim() ?? tipo.customerMessage,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        minimumOrderAmount: dto.minimumOrderAmount,
        maximumOrderAmount: dto.maximumOrderAmount ?? null,
        validityDays: dto.validityDays,
        usageLimitPerCustomer: dto.usageLimitPerCustomer,
        // Solo el tipo que los usa conserva estos campos.
        inactivityDays: code === 'INACTIVITY' ? (dto.inactivityDays ?? null) : null,
        birthdayWindowDays: code === 'BIRTHDAY' ? (dto.birthdayWindowDays ?? null) : null,
      },
    });

    return (await this.listar()).find((t) => t.code === code) as TipoCicloVidaDto;
  }

  /**
   * Interruptor Activo/Inactivo. Desactivar detiene nuevas emisiones pero no
   * invalida los cupones ya entregados (Word 6.9).
   */
  async cambiarActivo(code: string, isActive: boolean): Promise<TipoCicloVidaDto> {
    const tipo = await this.prisma.tipoCuponCicloVida.findUnique({ where: { code } });
    if (!tipo) throw new NotFoundException('Tipo de cupón no encontrado');
    await this.prisma.tipoCuponCicloVida.update({ where: { code }, data: { isActive } });
    return (await this.listar()).find((t) => t.code === code) as TipoCicloVidaDto;
  }

  /** "Emitir de prueba" para QA manual (Word 6.9). */
  async emitirDePrueba(code: string, clienteId: string): Promise<{ code: string }> {
    const tipo = await this.prisma.tipoCuponCicloVida.findUnique({ where: { code } });
    if (!tipo) throw new NotFoundException('Tipo de cupón no encontrado');
    const cupon = await this.cupones.emitir(tipo, OrigenCupon.LIFECYCLE, clienteId);
    return { code: cupon.code };
  }
}
