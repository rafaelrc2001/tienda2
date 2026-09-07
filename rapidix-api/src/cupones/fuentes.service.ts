import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FuenteAdquisicion, TipoFuente } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GuardarFuenteDto } from './dto/fuente.dto';

export interface FuenteDto {
  id: string;
  name: string;
  type: TipoFuente;
  code: string;
  isActive: boolean;
  /** Enlace unico para repartir: rapidix.mx/r/CODIGO (Word 4.9.4). */
  enlace: string;
  /** Clientes que llegaron por esta fuente. */
  clientesAtribuidos: number;
}

const BASE_POR_DEFECTO = 'https://rapidix.mx';

@Injectable()
export class FuentesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private enlaceDe(code: string): string {
    const base = (this.config.get<string>('APP_PUBLIC_URL') ?? BASE_POR_DEFECTO).replace(/\/$/, '');
    return `${base}/r/${code}`;
  }

  async listar(): Promise<FuenteDto[]> {
    const [fuentes, atribuciones] = await Promise.all([
      this.prisma.fuenteAdquisicion.findMany({ orderBy: { creado: 'desc' } }),
      this.prisma.cliente.groupBy({
        by: ['fuenteCodigo'],
        where: { fuenteCodigo: { not: null } },
        _count: { _all: true },
      }),
    ]);

    return fuentes.map((f) =>
      this.aDto(f, atribuciones.find((a) => a.fuenteCodigo === f.code)?._count._all ?? 0),
    );
  }

  async crear(dto: GuardarFuenteDto): Promise<FuenteDto> {
    const code = dto.code.trim().toUpperCase();
    const repetida = await this.prisma.fuenteAdquisicion.findUnique({ where: { code } });
    if (repetida) {
      throw new ConflictException(`Ya existe una fuente con el código "${code}".`);
    }
    const fuente = await this.prisma.fuenteAdquisicion.create({
      data: {
        name: dto.name.trim(),
        code,
        type: dto.type ?? TipoFuente.OTRO,
        isActive: dto.isActive ?? true,
      },
    });
    return this.aDto(fuente, 0);
  }

  /**
   * El codigo no se puede cambiar: ya esta impreso en carteles y QR, y los
   * clientes atribuidos lo guardan en `fuenteCodigo`. Para cambiarlo se crea
   * una fuente nueva y se desactiva la vieja.
   */
  async actualizar(id: string, dto: GuardarFuenteDto): Promise<FuenteDto> {
    const fuente = await this.prisma.fuenteAdquisicion.findUnique({ where: { id } });
    if (!fuente) throw new NotFoundException('Fuente no encontrada');

    if (dto.code.trim().toUpperCase() !== fuente.code) {
      throw new ConflictException(
        'El código de una fuente no se puede cambiar: el enlace ya está repartido. Crea una fuente nueva y desactiva esta.',
      );
    }

    const actualizada = await this.prisma.fuenteAdquisicion.update({
      where: { id },
      data: {
        name: dto.name.trim(),
        type: dto.type ?? fuente.type,
        isActive: dto.isActive ?? fuente.isActive,
      },
    });
    return (await this.listar()).find((f) => f.id === actualizada.id) as FuenteDto;
  }

  async eliminar(id: string): Promise<void> {
    const fuente = await this.prisma.fuenteAdquisicion.findUnique({ where: { id } });
    if (!fuente) throw new NotFoundException('Fuente no encontrada');

    const atribuidos = await this.prisma.cliente.count({ where: { fuenteCodigo: fuente.code } });
    if (atribuidos > 0) {
      throw new ConflictException(
        `${atribuidos} cliente(s) llegaron por esta fuente. Desactívala en vez de borrarla para no perder la atribución.`,
      );
    }
    await this.prisma.fuenteAdquisicion.delete({ where: { id } });
  }

  /**
   * Comprueba que un codigo de fuente exista y este activa.
   * Se usa al dar de alta un cliente: un codigo inventado se ignora en vez de
   * guardarse y ensuciar la atribucion.
   */
  async codigoValido(code: string | undefined | null): Promise<string | null> {
    if (!code?.trim()) return null;
    const fuente = await this.prisma.fuenteAdquisicion.findUnique({
      where: { code: code.trim().toUpperCase() },
    });
    return fuente?.isActive ? fuente.code : null;
  }

  private aDto(f: FuenteAdquisicion, clientesAtribuidos: number): FuenteDto {
    return {
      id: f.id,
      name: f.name,
      type: f.type,
      code: f.code,
      isActive: f.isActive,
      enlace: this.enlaceDe(f.code),
      clientesAtribuidos,
    };
  }
}
