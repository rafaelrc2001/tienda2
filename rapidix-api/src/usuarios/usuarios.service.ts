import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RolUsuario } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { ActualizarUsuarioDto, CrearUsuarioDto } from './dto/usuario.dto';

/** Lo que ve el panel de cada cuenta. Nunca lleva el hash. */
export interface UsuarioPanelDto {
  id: string;
  usuario: string;
  nombre: string;
  apellidos: string;
  /** `AAAA-MM-DD` o `null` en las cuentas de antes de la ficha. */
  fechaIngreso: string | null;
  rol: RolUsuario;
  tiendaId: string | null;
  tienda: string | null;
  activo: boolean;
}

const SELECCION = {
  id: true,
  usuario: true,
  nombre: true,
  apellidos: true,
  fechaIngreso: true,
  rol: true,
  tiendaId: true,
  activo: true,
  tienda: { select: { nombre: true } },
} satisfies Prisma.UsuarioSelect;

type FilaUsuario = Prisma.UsuarioGetPayload<{ select: typeof SELECCION }>;

/**
 * Configuracion -> Usuarios: alta y edicion del personal del negocio.
 *
 * No hay borrado: de un usuario cuelgan sus turnos, cortes y cobros. Se
 * retira desactivandolo, y desde ese momento ya no puede entrar.
 */
@Injectable()
export class UsuariosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(): Promise<UsuarioPanelDto[]> {
    const filas = await this.prisma.usuario.findMany({
      select: SELECCION,
      orderBy: [{ activo: 'desc' }, { rol: 'asc' }, { nombre: 'asc' }],
    });
    return filas.map(aDto);
  }

  async crear(dto: CrearUsuarioDto): Promise<UsuarioPanelDto> {
    await this.exigirTienda(dto.tiendaId);
    try {
      const fila = await this.prisma.usuario.create({
        data: {
          usuario: dto.usuario,
          passwordHash: await AuthService.hashPassword(dto.password),
          nombre: dto.nombre,
          apellidos: dto.apellidos,
          fechaIngreso: new Date(dto.fechaIngreso),
          rol: dto.rol,
          tiendaId: dto.tiendaId ?? null,
        },
        select: SELECCION,
      });
      return aDto(fila);
    } catch (error) {
      throw traducirDuplicado(error, dto.usuario);
    }
  }

  async actualizar(
    id: string,
    dto: ActualizarUsuarioDto,
    quien: UsuarioAutenticado,
  ): Promise<UsuarioPanelDto> {
    const actual = await this.prisma.usuario.findUnique({ where: { id } });
    if (!actual) throw new NotFoundException('Ese usuario no existe');

    // Quien administra no puede dejarse fuera a si mismo: se quedaria sin
    // nadie que pudiera devolverle el acceso.
    if (id === quien.sub) {
      if (dto.activo === false) {
        throw new BadRequestException('No puedes desactivar tu propia cuenta.');
      }
      if (dto.rol !== actual.rol) {
        throw new BadRequestException('No puedes cambiar el rol de tu propia cuenta.');
      }
    }

    await this.exigirTienda(dto.tiendaId);
    try {
      const fila = await this.prisma.usuario.update({
        where: { id },
        data: {
          usuario: dto.usuario,
          nombre: dto.nombre,
          apellidos: dto.apellidos,
          fechaIngreso: new Date(dto.fechaIngreso),
          rol: dto.rol,
          tiendaId: dto.tiendaId ?? null,
          ...(dto.activo !== undefined && { activo: dto.activo }),
          ...(dto.password && { passwordHash: await AuthService.hashPassword(dto.password) }),
        },
        select: SELECCION,
      });
      return aDto(fila);
    } catch (error) {
      throw traducirDuplicado(error, dto.usuario);
    }
  }

  /** Solo se asigna una tienda que exista y este activa. */
  private async exigirTienda(tiendaId: string | null | undefined): Promise<void> {
    if (!tiendaId) return;
    const tienda = await this.prisma.tienda.findUnique({ where: { id: tiendaId } });
    if (!tienda || !tienda.activa) {
      throw new BadRequestException('Esa tienda no existe o está desactivada.');
    }
  }
}

function aDto(fila: FilaUsuario): UsuarioPanelDto {
  return {
    id: fila.id,
    usuario: fila.usuario,
    nombre: fila.nombre,
    apellidos: fila.apellidos,
    fechaIngreso: fila.fechaIngreso ? fila.fechaIngreso.toISOString().slice(0, 10) : null,
    rol: fila.rol,
    tiendaId: fila.tiendaId,
    tienda: fila.tienda?.nombre ?? null,
    activo: fila.activo,
  };
}

/** El `@unique` de `usuario` es quien de verdad impide repetirlo. */
function traducirDuplicado(error: unknown, usuario: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ConflictException({
      statusCode: 409,
      code: 'USUARIO_DUPLICADO',
      message: `Ya hay una cuenta con el usuario «${usuario}».`,
    });
  }
  return error;
}
