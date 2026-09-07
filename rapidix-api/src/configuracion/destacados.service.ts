import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AvisoDto, NoticiaDto } from './dto/configuracion.dto';
import { ROL_CLIENTE, UsuarioAutenticado } from '../auth/jwt-payload';

export interface Destacados {
  noticias: { id: string; badge: string; titulo: string; desc: string; publicadoEn: string }[];
  avisos: { id: string; icon: string; titulo: string; desc: string; publicadoEn: string }[];
  /** Insignia numerica del icono de la barra inferior (Word 4.6). */
  noLeidos: number;
}

@Injectable()
export class DestacadosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Noticias y avisos, mas cuantos son nuevos para este cliente.
   *
   * El contador no es un numero guardado que se incrementa y se limpia: se
   * calcula comparando la fecha de publicacion con la ultima lectura del
   * cliente. Asi cada persona ve su propio "no leidos" y no hay contador
   * global que se desincronice.
   */
  async ver(usuario: UsuarioAutenticado): Promise<Destacados> {
    const [noticias, avisos] = await Promise.all([
      this.prisma.noticiaDestacada.findMany({ orderBy: { publicadoEn: 'desc' } }),
      this.prisma.aviso.findMany({ orderBy: { publicadoEn: 'desc' } }),
    ]);

    let noLeidos = 0;
    if (usuario.rol === ROL_CLIENTE) {
      const lectura = await this.prisma.lecturaDestacados.findUnique({
        where: { clienteId: usuario.sub },
      });
      // Sin marca de lectura, todo es nuevo.
      const desde = lectura?.ultimaLectura ?? new Date(0);
      noLeidos =
        noticias.filter((n) => n.publicadoEn > desde).length +
        avisos.filter((a) => a.publicadoEn > desde).length;
    }

    return {
      noticias: noticias.map((n) => ({
        id: n.id,
        badge: n.badge,
        titulo: n.titulo,
        desc: n.desc,
        publicadoEn: n.publicadoEn.toISOString(),
      })),
      avisos: avisos.map((a) => ({
        id: a.id,
        icon: a.icon,
        titulo: a.titulo,
        desc: a.desc,
        publicadoEn: a.publicadoEn.toISOString(),
      })),
      noLeidos,
    };
  }

  /** Se llama al entrar a Destacados: limpia la insignia. */
  async marcarLeido(usuario: UsuarioAutenticado): Promise<{ noLeidos: 0 }> {
    if (usuario.rol === ROL_CLIENTE) {
      const ahora = new Date();
      await this.prisma.lecturaDestacados.upsert({
        where: { clienteId: usuario.sub },
        update: { ultimaLectura: ahora },
        create: { clienteId: usuario.sub, ultimaLectura: ahora },
      });
    }
    return { noLeidos: 0 };
  }

  // ---- Administracion ----

  async publicarNoticia(dto: NoticiaDto) {
    return this.prisma.noticiaDestacada.create({
      data: {
        titulo: dto.titulo.trim(),
        badge: dto.badge?.trim() || 'Novedad',
        desc: dto.desc?.trim() || '',
      },
    });
  }

  async eliminarNoticia(id: string): Promise<void> {
    await this.prisma.noticiaDestacada.deleteMany({ where: { id } });
  }

  async publicarAviso(dto: AvisoDto) {
    return this.prisma.aviso.create({
      data: {
        titulo: dto.titulo.trim(),
        icon: dto.icon?.trim() || '📢',
        desc: dto.desc?.trim() || '',
      },
    });
  }

  async eliminarAviso(id: string): Promise<void> {
    await this.prisma.aviso.deleteMany({ where: { id } });
  }
}
