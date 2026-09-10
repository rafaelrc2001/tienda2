import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CategoriaDto {
  id: string;
  nombre: string;
  totalProductos: number;
  /** Orden de la familia en la Tienda: 1 va primero, 99 es "sin priorizar". */
  prioridad: number;
}

/**
 * Catalogo de categorias de producto.
 *
 * Nadie las da de alta a mano: se van creando solas conforme aparecen en un
 * alta de producto o en una importacion de Excel. La contrapartida es que hay
 * que evitar que el catalogo se llene de variantes del mismo nombre, asi que
 * el nombre se compara sin distinguir mayusculas y con los espacios recortados,
 * y cuando ya existe se reutiliza la que estaba en vez de crear otra.
 *
 * Una categoria no se borra al quedarse sin productos: las campanias de cupones
 * restringen por categoria (Word 4.9.3) y no pueden quedarse apuntando al aire
 * porque alguien haya dado de baja el ultimo producto de la lista.
 */
@Injectable()
export class CategoriasService {
  constructor(private readonly prisma: PrismaService) {}

  /** Recorta y colapsa los espacios de sobra: "  Frutas   y verduras ". */
  static limpiar(nombre: string): string {
    return nombre.trim().replace(/\s+/g, ' ');
  }

  /**
   * Id de la categoria que se llama asi, dandola de alta si es la primera vez
   * que se ve ese nombre.
   */
  async resolver(nombre: string): Promise<string> {
    const limpio = CategoriasService.limpiar(nombre);
    if (!limpio) throw new BadRequestException('La categoría no puede ir vacía.');

    const existente = await this.buscarPorNombre(limpio);
    if (existente) return existente;

    try {
      const creada = await this.prisma.categoria.create({
        data: { nombre: limpio },
        select: { id: true },
      });
      return creada.id;
    } catch (fallo) {
      // Dos altas simultaneas con la misma categoria nueva: gana la primera y
      // la segunda se cuelga de ella en vez de reventar.
      if (fallo instanceof Prisma.PrismaClientKnownRequestError && fallo.code === 'P2002') {
        const ganadora = await this.buscarPorNombre(limpio);
        if (ganadora) return ganadora;
      }
      throw fallo;
    }
  }

  private async buscarPorNombre(nombre: string): Promise<string | null> {
    const fila = await this.prisma.categoria.findFirst({
      where: { nombre: { equals: nombre, mode: 'insensitive' } },
      select: { id: true },
    });
    return fila?.id ?? null;
  }

  /**
   * El catalogo completo, con cuantos productos cuelgan de cada categoria.
   *
   * Sale en el mismo orden en que se veran las filas de la Tienda, no por
   * nombre: la pantalla que edita la prioridad tiene que ensenar el resultado
   * de lo que se acaba de cambiar.
   */
  async listar(): Promise<CategoriaDto[]> {
    const filas = await this.prisma.categoria.findMany({
      orderBy: [{ prioridad: 'asc' }, { nombre: 'asc' }],
      select: {
        id: true,
        nombre: true,
        prioridad: true,
        _count: { select: { productos: true } },
      },
    });
    return filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      totalProductos: f._count.productos,
      prioridad: f.prioridad,
    }));
  }

  /**
   * Cambia el orden de una familia en la Tienda (HU-01).
   *
   * La prioridad no es unica a proposito: dos familias empatadas se ordenan
   * entre ellas por nombre. Exigir un numero libre obligaria a renumerar media
   * lista para colar una familia nueva en medio.
   */
  async fijarPrioridad(id: string, prioridad: number): Promise<CategoriaDto> {
    const existe = await this.prisma.categoria.findUnique({ where: { id }, select: { id: true } });
    if (!existe) throw new NotFoundException('Categoría no encontrada');

    const fila = await this.prisma.categoria.update({
      where: { id },
      data: { prioridad },
      select: {
        id: true,
        nombre: true,
        prioridad: true,
        _count: { select: { productos: true } },
      },
    });
    return {
      id: fila.id,
      nombre: fila.nombre,
      totalProductos: fila._count.productos,
      prioridad: fila.prioridad,
    };
  }

  /** Solo los nombres: es lo que piden los chips de categoria de las campanias. */
  async listarNombres(): Promise<string[]> {
    const filas = await this.prisma.categoria.findMany({
      orderBy: { nombre: 'asc' },
      select: { nombre: true },
    });
    return filas.map((f) => f.nombre);
  }
}
