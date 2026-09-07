import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrigenReceta, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BuscarRecetasDto } from './dto/buscar-recetas.dto';
import { GuardarRecetaDto } from './dto/guardar-receta.dto';
import { ROL_CLIENTE, UsuarioAutenticado } from '../auth/jwt-payload';

export interface RecetaResumen {
  id: string;
  nombre: string;
  tiempo: string;
  porciones: number;
  imagenUrl: string | null;
  emoji: string | null;
  categorias: string[];
  autorNombre: string;
  origin: OrigenReceta;
  compartir: boolean;
  esPropia: boolean;
  guardada: boolean;
  calificacionPromedio: number | null;
  totalCalificaciones: number;
}

export interface RecetaDetalle extends RecetaResumen {
  youtube: string | null;
  ingredientes: { nombre: string; cantidad: string }[];
  pasos: string[];
  /** Calificacion que dio este cliente, si ya califico. */
  miCalificacion: number | null;
  /** Si ya marco "!Listo a comer!" y por tanto puede calificar (Word 6.4). */
  puedeCalificar: boolean;
}

const EMOJI_POR_CATEGORIA: Record<string, string> = {
  desayuno: '🥞',
  comida: '🍗',
  cena: '☕',
};

@Injectable()
export class RecetarioService {
  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------------
  // Lectura
  // ----------------------------------------------------------------

  /**
   * Listado del Recetario segun la pestana activa.
   *
   * - `recetario`: las oficiales del negocio.
   * - `mias`: las que creo el cliente mas las que guardo de otros.
   * - `comunidad`: cualquier receta compartida.
   */
  async listar(usuario: UsuarioAutenticado, filtros: BuscarRecetasDto): Promise<RecetaResumen[]> {
    const pestana = filtros.pestana ?? 'recetario';
    const esCliente = usuario.rol === ROL_CLIENTE;

    if (pestana === 'mias' && !esCliente) {
      throw new BadRequestException('La pestaña "Mis Recetas" solo existe para clientes.');
    }

    const where: Prisma.RecetaWhereInput = {};

    if (pestana === 'recetario') {
      where.origin = OrigenReceta.RECETARIO;
    } else if (pestana === 'comunidad') {
      // Solo `compartir`, sin mirar el origen: una receta propia que el cliente
      // decide compartir tambien aparece aqui (mockup, linea 1513).
      where.compartir = true;
    } else {
      // "Mis Recetas": propias o guardadas.
      where.OR = [
        { autorClienteId: usuario.sub },
        { guardadaPor: { some: { clienteId: usuario.sub } } },
      ];
    }

    if (filtros.categoria && filtros.categoria !== 'todas') {
      where.categorias = { has: filtros.categoria };
    }

    const termino = filtros.q?.trim();
    if (termino) {
      // Por nombre de receta O por ingrediente (Word 4.4).
      const porTexto: Prisma.RecetaWhereInput = {
        OR: [
          { nombre: { contains: termino, mode: 'insensitive' } },
          { ingredientes: { some: { nombre: { contains: termino, mode: 'insensitive' } } } },
        ],
      };
      where.AND = where.AND ? [where.AND, porTexto].flat() : [porTexto];
    }

    const recetas = await this.prisma.receta.findMany({ where, orderBy: { nombre: 'asc' } });
    if (recetas.length === 0) return [];

    const ids = recetas.map((r) => r.id);
    const [promedios, guardadas] = await Promise.all([
      this.promediosPorReceta(ids),
      esCliente ? this.guardadasPorCliente(usuario.sub, ids) : Promise.resolve(new Set<string>()),
    ]);

    return recetas.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      tiempo: r.tiempo,
      porciones: r.porciones,
      imagenUrl: r.imagenUrl,
      emoji: r.emoji,
      categorias: r.categorias,
      autorNombre: r.autorNombre,
      origin: r.origin,
      compartir: r.compartir,
      esPropia: esCliente && r.autorClienteId === usuario.sub,
      guardada: guardadas.has(r.id),
      ...(promedios.get(r.id) ?? { calificacionPromedio: null, totalCalificaciones: 0 }),
    }));
  }

  async obtener(id: string, usuario: UsuarioAutenticado): Promise<RecetaDetalle> {
    const receta = await this.prisma.receta.findUnique({
      where: { id },
      include: {
        ingredientes: { orderBy: { orden: 'asc' } },
        pasos: { orderBy: { orden: 'asc' } },
      },
    });
    if (!receta) throw new NotFoundException('Receta no encontrada');

    const esCliente = usuario.rol === ROL_CLIENTE;
    const [promedios, guardadas, miCalificacion, cocinada] = await Promise.all([
      this.promediosPorReceta([id]),
      esCliente ? this.guardadasPorCliente(usuario.sub, [id]) : Promise.resolve(new Set<string>()),
      esCliente
        ? this.prisma.recetaCalificacion.findUnique({
            where: { clienteId_recetaId: { clienteId: usuario.sub, recetaId: id } },
            select: { puntuacion: true },
          })
        : Promise.resolve(null),
      esCliente
        ? this.prisma.recetaCocinada.count({ where: { clienteId: usuario.sub, recetaId: id } })
        : Promise.resolve(0),
    ]);

    return {
      id: receta.id,
      nombre: receta.nombre,
      tiempo: receta.tiempo,
      porciones: receta.porciones,
      imagenUrl: receta.imagenUrl,
      emoji: receta.emoji,
      categorias: receta.categorias,
      autorNombre: receta.autorNombre,
      origin: receta.origin,
      compartir: receta.compartir,
      youtube: receta.youtube,
      esPropia: esCliente && receta.autorClienteId === usuario.sub,
      guardada: guardadas.has(id),
      miCalificacion: miCalificacion?.puntuacion ?? null,
      // Solo se califica despues de confirmar "!Listo a comer!" (Word 6.4).
      puedeCalificar: cocinada > 0,
      ingredientes: receta.ingredientes.map((i) => ({ nombre: i.nombre, cantidad: i.cantidad })),
      pasos: receta.pasos.map((p) => p.texto),
      ...(promedios.get(id) ?? { calificacionPromedio: null, totalCalificaciones: 0 }),
    };
  }

  // ----------------------------------------------------------------
  // Escritura
  // ----------------------------------------------------------------

  /** Crea una receta propia del cliente (HU-C06). */
  async crearPropia(usuario: UsuarioAutenticado, dto: GuardarRecetaDto): Promise<RecetaDetalle> {
    if (usuario.rol !== ROL_CLIENTE) {
      throw new BadRequestException('Solo un cliente puede crear recetas propias.');
    }
    const receta = await this.prisma.receta.create({
      data: {
        ...RecetarioService.camposComunes(dto),
        autorNombre: usuario.nombre,
        autorClienteId: usuario.sub,
        origin: OrigenReceta.PROPIA,
        compartir: dto.compartir ?? false,
        ingredientes: { create: RecetarioService.ingredientes(dto) },
        pasos: { create: RecetarioService.pasos(dto) },
      },
    });
    return this.obtener(receta.id, usuario);
  }

  /** Crea una receta oficial del Recetario (HU-A03). */
  async crearOficial(usuario: UsuarioAutenticado, dto: GuardarRecetaDto): Promise<RecetaDetalle> {
    const receta = await this.prisma.receta.create({
      data: {
        ...RecetarioService.camposComunes(dto),
        autorNombre: 'Rapidix',
        autorClienteId: null,
        origin: OrigenReceta.RECETARIO,
        // Una receta oficial no se "comparte con la comunidad": ya es publica.
        compartir: false,
        ingredientes: { create: RecetarioService.ingredientes(dto) },
        pasos: { create: RecetarioService.pasos(dto) },
      },
    });
    return this.obtener(receta.id, usuario);
  }

  /**
   * Edita una receta. Ingredientes y pasos se reemplazan enteros: el formulario
   * del prototipo edita la lista completa, no elemento a elemento.
   */
  async editar(
    id: string,
    usuario: UsuarioAutenticado,
    dto: GuardarRecetaDto,
    comoAdministrador: boolean,
  ): Promise<RecetaDetalle> {
    const receta = await this.prisma.receta.findUnique({ where: { id } });
    if (!receta) throw new NotFoundException('Receta no encontrada');

    if (!comoAdministrador) {
      // "Editar receta" solo aparece si la receta es propia (Word 6.4).
      if (receta.autorClienteId !== usuario.sub) {
        throw new ForbiddenException('Solo puedes editar tus propias recetas.');
      }
    } else if (receta.origin !== OrigenReceta.RECETARIO) {
      throw new ForbiddenException(
        'Desde Administración solo se editan las recetas oficiales del Recetario.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.recetaIngrediente.deleteMany({ where: { recetaId: id } }),
      this.prisma.recetaPaso.deleteMany({ where: { recetaId: id } }),
      this.prisma.receta.update({
        where: { id },
        data: {
          ...RecetarioService.camposComunes(dto),
          ...(!comoAdministrador && dto.compartir !== undefined && { compartir: dto.compartir }),
          ingredientes: { create: RecetarioService.ingredientes(dto) },
          pasos: { create: RecetarioService.pasos(dto) },
        },
      }),
    ]);

    return this.obtener(id, usuario);
  }

  /** "Dejar de compartir con la comunidad" del menu del detalle (Word 6.4). */
  async cambiarCompartir(
    id: string,
    usuario: UsuarioAutenticado,
    compartir: boolean,
  ): Promise<RecetaDetalle> {
    const receta = await this.prisma.receta.findUnique({ where: { id } });
    if (!receta) throw new NotFoundException('Receta no encontrada');
    if (receta.autorClienteId !== usuario.sub) {
      throw new ForbiddenException('Solo puedes compartir tus propias recetas.');
    }
    await this.prisma.receta.update({ where: { id }, data: { compartir } });
    return this.obtener(id, usuario);
  }

  // ----------------------------------------------------------------

  private static camposComunes(dto: GuardarRecetaDto) {
    return {
      nombre: dto.nombre.trim(),
      tiempo: dto.tiempo?.trim() || 'N/D',
      porciones: dto.porciones ?? 1,
      imagenUrl: dto.imagenUrl ?? null,
      // Igual que el prototipo: si no hay foto, el emoji sale de la categoria.
      emoji: dto.emoji ?? EMOJI_POR_CATEGORIA[dto.categorias[0]] ?? '🍽️',
      youtube: dto.youtube?.trim() || null,
      categorias: dto.categorias,
    };
  }

  private static ingredientes(dto: GuardarRecetaDto) {
    return (dto.ingredientes ?? []).map((ing, i) => ({
      nombre: ing.nombre.trim(),
      cantidad: ing.cantidad?.trim() ?? '',
      orden: i + 1,
    }));
  }

  private static pasos(dto: GuardarRecetaDto) {
    return (dto.pasos ?? [])
      .map((texto) => texto.trim())
      .filter((texto) => texto.length > 0)
      .map((texto, i) => ({ texto, orden: i + 1 }));
  }

  /** Promedio y numero de calificaciones, en una sola consulta agrupada. */
  private async promediosPorReceta(
    ids: string[],
  ): Promise<Map<string, { calificacionPromedio: number | null; totalCalificaciones: number }>> {
    const grupos = await this.prisma.recetaCalificacion.groupBy({
      by: ['recetaId'],
      where: { recetaId: { in: ids } },
      _avg: { puntuacion: true },
      _count: { puntuacion: true },
    });

    return new Map(
      grupos.map((g) => [
        g.recetaId,
        {
          calificacionPromedio:
            g._avg.puntuacion === null ? null : Math.round(g._avg.puntuacion * 10) / 10,
          totalCalificaciones: g._count.puntuacion,
        },
      ]),
    );
  }

  private async guardadasPorCliente(clienteId: string, ids: string[]): Promise<Set<string>> {
    const filas = await this.prisma.recetaGuardada.findMany({
      where: { clienteId, recetaId: { in: ids } },
      select: { recetaId: true },
    });
    return new Set(filas.map((f) => f.recetaId));
  }
}
