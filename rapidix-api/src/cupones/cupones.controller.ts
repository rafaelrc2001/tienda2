import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { CuponesService } from './cupones.service';
import { CampaniasService } from './campanias.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { ROL_CLIENTE, UsuarioAutenticado } from '../auth/jwt-payload';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

export interface MiCuponDto {
  id: string;
  code: string;
  title: string;
  /** Texto largo del cupon. La tarjeta lo pinta bajo el titulo. */
  description: string | null;
  customerMessage: string | null;
  discountType: string;
  discountValue: number;
  minimumOrderAmount: number;
  maximumOrderAmount: number | null;
  expiresAt: string;
  /**
   * De donde salio: LIFECYCLE o CAMPAIGN. El Home lo usa para destacar el
   * cupon de ciclo de vida en "Para ti hoy" (Word 4.1).
   */
  sourceKind: string;
  sourceCode: string;
}

@ApiTags('Cupones')
@ApiBearerAuth()
@Controller('cupones')
export class CuponesController {
  constructor(
    private readonly cupones: CuponesService,
    private readonly campanias: CampaniasService,
    private readonly prisma: PrismaService,
  ) {}

  /** Pestana "Mis Cupones" del cliente (Word 4.5). */
  @Get()
  async misCupones(@UsuarioActual() usuario: UsuarioAutenticado): Promise<MiCuponDto[]> {
    if (usuario.rol !== ROL_CLIENTE) {
      throw new ForbiddenException('Esta sección es exclusiva para clientes.');
    }
    // Se reevaluan las campanias por si el cliente califico desde su ultimo
    // ingreso, o por si se creo una campana nueva (Word 4.5).
    const cliente = await this.prisma.cliente.findUnique({ where: { id: usuario.sub } });
    if (cliente) await this.campanias.emitirCampaniasElegibles(cliente);

    const cupones = await this.cupones.misCupones(usuario.sub);
    return cupones.map((c) => ({
      id: c.id,
      code: c.code,
      title: c.title,
      description: c.description,
      customerMessage: c.customerMessage,
      discountType: c.discountType,
      discountValue: c.discountValue.toNumber(),
      minimumOrderAmount: c.minimumOrderAmount.toNumber(),
      maximumOrderAmount: c.maximumOrderAmount?.toNumber() ?? null,
      expiresAt: c.expiresAt.toISOString(),
      sourceKind: c.sourceKind,
      sourceCode: c.sourceCode,
    }));
  }
}
