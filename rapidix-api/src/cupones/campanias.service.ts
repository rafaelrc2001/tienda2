import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Campania, Cliente, CuponEmitido, EstadoCupon, OrigenCupon, TipoAudiencia } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CuponesService } from './cupones.service';
import { GuardarCampaniaDto } from './dto/campania.dto';
import { ClienteSegmentable, ReglaSegmento, clienteCumpleSegmento } from './segmentacion';

export interface CampaniaDto {
  id: string;
  name: string;
  title: string;
  description: string | null;
  customerMessage: string | null;
  discountType: string;
  discountValue: number;
  minimumOrderAmount: number;
  maximumOrderAmount: number | null;
  startsAt: string | null;
  endsAt: string | null;
  usageLimitTotal: number;
  usageLimitPerCustomer: number;
  targetType: TipoAudiencia;
  sourceCode: string | null;
  segmentRules: ReglaSegmento[];
  categorias: string[];
  isActive: boolean;
  generados: number;
  utilizados: number;
  porcentajeUtilizacion: number;
}

@Injectable()
export class CampaniasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cupones: CuponesService,
  ) {}

  // ----------------------------------------------------------------
  // CRUD
  // ----------------------------------------------------------------

  async listar(): Promise<CampaniaDto[]> {
    const [campanias, grupos] = await Promise.all([
      this.prisma.campania.findMany({ orderBy: { creado: 'desc' } }),
      this.prisma.cuponEmitido.groupBy({
        by: ['sourceCode', 'status'],
        where: { sourceKind: OrigenCupon.CAMPAIGN },
        _count: { _all: true },
      }),
    ]);

    return campanias.map((c) => {
      const generados = grupos
        .filter((g) => g.sourceCode === c.name)
        .reduce((s, g) => s + g._count._all, 0);
      const utilizados = grupos
        .filter((g) => g.sourceCode === c.name && g.status === EstadoCupon.USED)
        .reduce((s, g) => s + g._count._all, 0);
      return CampaniasService.aDto(c, generados, utilizados);
    });
  }

  async crear(dto: GuardarCampaniaDto): Promise<CampaniaDto> {
    CampaniasService.validarCoherencia(dto);
    const repetida = await this.prisma.campania.findUnique({ where: { name: dto.name.trim() } });
    if (repetida) {
      throw new ConflictException(`Ya existe una campaña con el nombre interno "${dto.name}".`);
    }
    const campania = await this.prisma.campania.create({ data: CampaniasService.aDatos(dto) });
    return CampaniasService.aDto(campania, 0, 0);
  }

  async actualizar(id: string, dto: GuardarCampaniaDto): Promise<CampaniaDto> {
    CampaniasService.validarCoherencia(dto);
    const actual = await this.prisma.campania.findUnique({ where: { id } });
    if (!actual) throw new NotFoundException('Campaña no encontrada');

    const nombre = dto.name.trim();
    if (nombre !== actual.name) {
      const repetida = await this.prisma.campania.findUnique({ where: { name: nombre } });
      if (repetida) {
        throw new ConflictException(`Ya existe una campaña con el nombre interno "${nombre}".`);
      }
      // `sourceCode` de los cupones ya emitidos apunta al nombre: hay que
      // moverlos con la campana o quedarian huerfanos en las metricas.
      await this.prisma.cuponEmitido.updateMany({
        where: { sourceKind: OrigenCupon.CAMPAIGN, sourceCode: actual.name },
        data: { sourceCode: nombre },
      });
    }

    await this.prisma.campania.update({ where: { id }, data: CampaniasService.aDatos(dto) });
    return (await this.listar()).find((c) => c.id === id) as CampaniaDto;
  }

  async cambiarActivo(id: string, isActive: boolean): Promise<CampaniaDto> {
    const existe = await this.prisma.campania.count({ where: { id } });
    if (existe === 0) throw new NotFoundException('Campaña no encontrada');
    await this.prisma.campania.update({ where: { id }, data: { isActive } });
    return (await this.listar()).find((c) => c.id === id) as CampaniaDto;
  }

  /**
   * Elimina la campana. Los cupones ya emitidos NO se borran: siguen siendo
   * validos para el cliente que los recibio y sus importes estan congelados.
   */
  async eliminar(id: string): Promise<void> {
    const existe = await this.prisma.campania.count({ where: { id } });
    if (existe === 0) throw new NotFoundException('Campaña no encontrada');
    await this.prisma.campania.delete({ where: { id } });
  }

  async emitirDePrueba(id: string, clienteId: string): Promise<{ code: string }> {
    const campania = await this.prisma.campania.findUnique({ where: { id } });
    if (!campania) throw new NotFoundException('Campaña no encontrada');
    const cupon = await this.cupones.emitir(campania, OrigenCupon.CAMPAIGN, { clienteId });
    return { code: cupon.code };
  }

  // ----------------------------------------------------------------
  // Evaluacion de audiencia
  // ----------------------------------------------------------------

  /**
   * Emite los cupones de las campanias activas para las que el cliente
   * califique. Se invoca al iniciar sesion y al abrir la pantalla de Cupones,
   * asi que una campana creada hoy alcanza tambien a clientes de ayer
   * (Word 5, regla 9).
   */
  async emitirCampaniasElegibles(cliente: Cliente): Promise<CuponEmitido[]> {
    const ahora = new Date();

    // El filtro de vigencia va en SQL: no tiene sentido traer campanas
    // caducadas para descartarlas en memoria.
    const candidatas = await this.prisma.campania.findMany({
      where: {
        isActive: true,
        OR: [{ startsAt: null }, { startsAt: { lte: ahora } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: CampaniasService.inicioDelDia(ahora) } }] }],
      },
    });

    const emitidos: CuponEmitido[] = [];
    for (const campania of candidatas) {
      if (campania.endsAt && ahora > CampaniasService.finDelDia(campania.endsAt)) continue;
      if (await this.cupones.tieneCuponActivoOUsado(cliente.id, campania.name)) continue;
      if (!CampaniasService.clienteCalifica(cliente, campania, ahora)) continue;
      emitidos.push(await this.cupones.emitir(campania, OrigenCupon.CAMPAIGN, { clienteId: cliente.id }));
    }
    return emitidos;
  }

  /** Traduce la audiencia de la campana a un si/no para este cliente. */
  static clienteCalifica(cliente: Cliente, campania: Campania, ahora = new Date()): boolean {
    switch (campania.targetType) {
      case TipoAudiencia.ALL:
        return true;
      case TipoAudiencia.NEW_CUSTOMERS:
        return cliente.pedidos === 0;
      case TipoAudiencia.EXISTING_CUSTOMERS:
        return cliente.pedidos > 0;
      case TipoAudiencia.SOURCE:
        // `fuenteCodigo` se captura en el alta a partir del enlace de la
        // fuente; hasta el paso 17 nadie lo tiene y esto no califica a nadie.
        return !!campania.sourceCode && cliente.fuenteCodigo === campania.sourceCode;
      case TipoAudiencia.SEGMENT:
        return clienteCumpleSegmento(
          CampaniasService.aSegmentable(cliente),
          campania.segmentRules as unknown as ReglaSegmento[],
          ahora,
        );
      case TipoAudiencia.REFERRAL:
        // El programa de referidos esta fuera del SPEC 01 (Word 8).
        return false;
      default:
        return false;
    }
  }

  // ----------------------------------------------------------------

  private static aSegmentable(cliente: Cliente): ClienteSegmentable {
    return {
      pedidos: cliente.pedidos,
      totalGastado: cliente.totalGastado.toNumber(),
      ultimoPedido: cliente.ultimoPedido,
      creado: cliente.creado,
      nombre: cliente.nombre,
      telefono: cliente.telefono,
      sucursal: cliente.sucursal,
      colonia: cliente.colonia,
      ciudad: cliente.ciudad,
      estado: cliente.estado,
      fechaNacimiento: cliente.fechaNacimiento,
    };
  }

  private static inicioDelDia(fecha: Date): Date {
    const d = new Date(fecha);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private static finDelDia(fecha: Date): Date {
    const d = new Date(fecha);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  /** Reglas que el panel no puede saltarse (Word 6.9). */
  private static validarCoherencia(dto: GuardarCampaniaDto): void {
    if (dto.targetType === TipoAudiencia.SEGMENT && (dto.segmentRules ?? []).length === 0) {
      throw new BadRequestException(
        'Una campaña de segmento personalizado necesita al menos una regla; si no, no califica a nadie.',
      );
    }
    if (dto.targetType === TipoAudiencia.SOURCE && !dto.sourceCode?.trim()) {
      throw new BadRequestException('Indica el código de fuente para una campaña por fuente.');
    }
    if (dto.startsAt && dto.endsAt && new Date(dto.startsAt) > new Date(dto.endsAt)) {
      throw new BadRequestException('La fecha de inicio no puede ser posterior a la de fin.');
    }
  }

  private static aDatos(dto: GuardarCampaniaDto) {
    return {
      name: dto.name.trim(),
      title: dto.title.trim(),
      description: dto.description?.trim() ?? null,
      customerMessage: dto.customerMessage?.trim() ?? null,
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      minimumOrderAmount: dto.minimumOrderAmount,
      maximumOrderAmount: dto.maximumOrderAmount ?? null,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      usageLimitTotal: dto.usageLimitTotal ?? 0,
      usageLimitPerCustomer: dto.usageLimitPerCustomer ?? 1,
      targetType: dto.targetType,
      sourceCode: dto.sourceCode?.trim() || null,
      segmentRules: (dto.segmentRules ?? []) as unknown as object[],
      categorias: dto.categorias ?? [],
      isActive: dto.isActive ?? true,
    };
  }

  private static aDto(c: Campania, generados: number, utilizados: number): CampaniaDto {
    return {
      id: c.id,
      name: c.name,
      title: c.title,
      description: c.description,
      customerMessage: c.customerMessage,
      discountType: c.discountType,
      discountValue: c.discountValue.toNumber(),
      minimumOrderAmount: c.minimumOrderAmount.toNumber(),
      maximumOrderAmount: c.maximumOrderAmount?.toNumber() ?? null,
      startsAt: c.startsAt?.toISOString() ?? null,
      endsAt: c.endsAt?.toISOString() ?? null,
      usageLimitTotal: c.usageLimitTotal,
      usageLimitPerCustomer: c.usageLimitPerCustomer,
      targetType: c.targetType,
      sourceCode: c.sourceCode,
      segmentRules: c.segmentRules as unknown as ReglaSegmento[],
      categorias: c.categorias,
      isActive: c.isActive,
      generados,
      utilizados,
      porcentajeUtilizacion: generados === 0 ? 0 : Math.round((utilizados / generados) * 100),
    };
  }
}
