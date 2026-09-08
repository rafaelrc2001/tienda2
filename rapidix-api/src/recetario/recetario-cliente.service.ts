import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ROL_CLIENTE, UsuarioAutenticado } from '../auth/jwt-payload';

/** Ventana del Historial de recetas cocinadas (Word 4.4). */
export const DIAS_HISTORIAL = 35;

export interface RecetaPausadaDto {
  recetaId: string;
  nombre: string;
  emoji: string | null;
  imagenUrl: string | null;
  pausadaEn: string;
}

export interface EntradaHistorial {
  fecha: string;
  categoria: string;
  recetaId: string;
  receta: string;
  emoji: string | null;
}

@Injectable()
export class RecetarioClienteService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Todas estas acciones son del cliente sobre su propio estado.
   *
   * Quien todavia no ha comprado puede leer el Recetario, pero no guardar,
   * pausar, cocinar ni calificar: todo eso cuelga de `clientes` y el no tiene
   * fila alli hasta su primer pedido. Se comprueba contra la base y no contra
   * el `tipo` del token, que puede haberse quedado viejo tras convertirse.
   */
  private async exigirCliente(usuario: UsuarioAutenticado): Promise<string> {
    if (usuario.rol !== ROL_CLIENTE) {
      throw new ForbiddenException('Esta acción es exclusiva de clientes.');
    }
    if (!(await this.prisma.cliente.count({ where: { id: usuario.sub } }))) {
      throw new ForbiddenException('Haz tu primer pedido para guardar recetas.');
    }
    return usuario.sub;
  }

  private async exigirReceta(recetaId: string): Promise<void> {
    const existe = await this.prisma.receta.count({ where: { id: recetaId } });
    if (existe === 0) throw new NotFoundException('Receta no encontrada');
  }

  // ----------------------------------------------------------------
  // Mis Recetas (HU-C07)
  // ----------------------------------------------------------------

  async guardar(recetaId: string, usuario: UsuarioAutenticado): Promise<{ guardada: true }> {
    const clienteId = await this.exigirCliente(usuario);
    await this.exigirReceta(recetaId);
    await this.prisma.recetaGuardada.upsert({
      where: { clienteId_recetaId: { clienteId, recetaId } },
      update: {},
      create: { clienteId, recetaId },
    });
    return { guardada: true };
  }

  async quitarGuardada(recetaId: string, usuario: UsuarioAutenticado): Promise<{ guardada: false }> {
    const clienteId = await this.exigirCliente(usuario);
    await this.prisma.recetaGuardada.deleteMany({ where: { clienteId, recetaId } });
    return { guardada: false };
  }

  // ----------------------------------------------------------------
  // Receta en pausa (HU-C09)
  // ----------------------------------------------------------------

  async verPausada(usuario: UsuarioAutenticado): Promise<RecetaPausadaDto | null> {
    const clienteId = await this.exigirCliente(usuario);
    const pausada = await this.prisma.recetaPausada.findUnique({
      where: { clienteId },
      include: { receta: { select: { id: true, nombre: true, emoji: true, imagenUrl: true } } },
    });
    if (!pausada) return null;
    return {
      recetaId: pausada.receta.id,
      nombre: pausada.receta.nombre,
      emoji: pausada.receta.emoji,
      imagenUrl: pausada.receta.imagenUrl,
      pausadaEn: pausada.pausadaEn.toISOString(),
    };
  }

  /**
   * Pausa una receta. `RecetaPausada` tiene `clienteId` como clave primaria,
   * asi que el upsert sustituye la anterior: por esquema es imposible tener
   * dos recetas en pausa a la vez (Word 6.4).
   */
  async pausar(recetaId: string, usuario: UsuarioAutenticado): Promise<RecetaPausadaDto> {
    const clienteId = await this.exigirCliente(usuario);
    await this.exigirReceta(recetaId);
    await this.prisma.recetaPausada.upsert({
      where: { clienteId },
      update: { recetaId, pausadaEn: new Date() },
      create: { clienteId, recetaId },
    });
    return (await this.verPausada(usuario)) as RecetaPausadaDto;
  }

  /** "Continuar receta" o "Cancelar receta" del aviso de Home. */
  async quitarPausa(usuario: UsuarioAutenticado): Promise<{ pausada: null }> {
    const clienteId = await this.exigirCliente(usuario);
    await this.prisma.recetaPausada.deleteMany({ where: { clienteId } });
    return { pausada: null };
  }

  // ----------------------------------------------------------------
  // "!Listo a comer!" y calificacion (HU-C08)
  // ----------------------------------------------------------------

  /**
   * Registra que el cliente cocino la receta. Es requisito previo para poder
   * calificarla, y ademas limpia la pausa si era justo esa receta, igual que
   * el prototipo.
   */
  async marcarCocinada(
    recetaId: string,
    usuario: UsuarioAutenticado,
  ): Promise<{ cocinadaEn: string; puedeCalificar: true }> {
    const clienteId = await this.exigirCliente(usuario);
    await this.exigirReceta(recetaId);

    const registro = await this.prisma.recetaCocinada.create({
      data: { clienteId, recetaId },
    });

    await this.prisma.recetaPausada.deleteMany({ where: { clienteId, recetaId } });

    return { cocinadaEn: registro.cocinadaEn.toISOString(), puedeCalificar: true };
  }

  /**
   * Califica una receta. Solo se acepta si el cliente ya marco
   * "!Listo a comer!" para ella: la calificacion refleja que si la cocino
   * (HU-C08).
   */
  async calificar(
    recetaId: string,
    usuario: UsuarioAutenticado,
    puntuacion: number,
  ): Promise<{ puntuacion: number }> {
    const clienteId = await this.exigirCliente(usuario);
    await this.exigirReceta(recetaId);

    const cocinada = await this.prisma.recetaCocinada.count({ where: { clienteId, recetaId } });
    if (cocinada === 0) {
      throw new ConflictException(
        'Confirma "¡Listo a comer!" antes de calificar: así la calificación refleja que sí la cocinaste.',
      );
    }

    // Una calificacion por cliente y receta; volver a calificar la corrige.
    await this.prisma.recetaCalificacion.upsert({
      where: { clienteId_recetaId: { clienteId, recetaId } },
      update: { puntuacion },
      create: { clienteId, recetaId, puntuacion },
    });

    return { puntuacion };
  }

  // ----------------------------------------------------------------
  // Historial (HU-C10)
  // ----------------------------------------------------------------

  /** Lo cocinado en los ultimos 35 dias, lo mas reciente primero. */
  async historial(usuario: UsuarioAutenticado): Promise<EntradaHistorial[]> {
    const clienteId = await this.exigirCliente(usuario);
    const desde = new Date(Date.now() - DIAS_HISTORIAL * 24 * 60 * 60 * 1000);

    const filas = await this.prisma.recetaCocinada.findMany({
      where: { clienteId, cocinadaEn: { gte: desde } },
      orderBy: { cocinadaEn: 'desc' },
      include: { receta: { select: { id: true, nombre: true, emoji: true, categorias: true } } },
    });

    return filas.map((f) => ({
      fecha: f.cocinadaEn.toISOString(),
      categoria: f.receta.categorias[0] ?? '',
      recetaId: f.receta.id,
      receta: f.receta.nombre,
      emoji: f.receta.emoji,
    }));
  }
}
