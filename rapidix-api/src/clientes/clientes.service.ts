import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ActualizarPerfilDto,
  BuscarClientesDto,
  ClienteAdminDto,
  PaginaClientesDto,
  PerfilDto,
} from './dto/perfil.dto';

/** Lo que hace falta para armar un PerfilDto. */
const SELECT_PERFIL = {
  id: true,
  nombre: true,
  email: true,
  telefono: true,
  fechaNacimiento: true,
  quienRecibe: true,
  calle: true,
  colonia: true,
  cp: true,
  ciudad: true,
  estado: true,
  referencias: true,
  lat: true,
  lng: true,
  notificaciones: true,
  pedidos: true,
  totalGastado: true,
  primerPedido: true,
  ultimoPedido: true,
  creado: true,
} satisfies Prisma.ClienteSelect;

type ClientePerfil = Prisma.ClienteGetPayload<{ select: typeof SELECT_PERFIL }>;

@Injectable()
export class ClientesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pantalla Perfil del cliente (Word 4.7). */
  async perfil(clienteId: string): Promise<PerfilDto> {
    const cliente = await this.prisma.cliente.findUnique({
      where: { id: clienteId },
      select: SELECT_PERFIL,
    });
    if (!cliente) {
      throw new NotFoundException('No encontramos tu perfil');
    }
    return ClientesService.aPerfil(cliente);
  }

  /**
   * Guarda los datos editables del perfil.
   *
   * `telefono` no se toca: no esta en el DTO y `forbidNonWhitelisted` rechaza
   * el intento con un 400 antes de llegar aqui.
   */
  async actualizar(clienteId: string, cambios: ActualizarPerfilDto): Promise<PerfilDto> {
    const existe = await this.prisma.cliente.count({ where: { id: clienteId } });
    if (!existe) {
      throw new NotFoundException('No encontramos tu perfil');
    }

    const { fechaNacimiento, ...resto } = cambios;
    const cliente = await this.prisma.cliente.update({
      where: { id: clienteId },
      data: {
        ...resto,
        ...(fechaNacimiento !== undefined ? { fechaNacimiento: new Date(fechaNacimiento) } : {}),
      },
      select: SELECT_PERFIL,
    });
    return ClientesService.aPerfil(cliente);
  }

  /** Administracion -> Clientes: listado con buscador, orden y paginacion. */
  async listarParaAdmin(filtros: BuscarClientesDto): Promise<PaginaClientesDto> {
    const pagina = filtros.pagina ?? 1;
    const porPagina = filtros.porPagina ?? 25;

    const termino = filtros.q?.trim();
    const where: Prisma.ClienteWhereInput = termino
      ? {
          OR: [
            { nombre: { contains: termino, mode: 'insensitive' } },
            { telefono: { contains: termino } },
          ],
        }
      : {};

    // `ultimoPedido` es nulo para quien nunca ha comprado: va al final.
    const campo = filtros.orden ?? 'ultimoPedido';
    const orderBy: Prisma.ClienteOrderByWithRelationInput = {
      [campo]: { sort: 'desc', nulls: 'last' },
    };

    const [total, filas] = await this.prisma.$transaction([
      this.prisma.cliente.count({ where }),
      this.prisma.cliente.findMany({
        where,
        orderBy,
        skip: (pagina - 1) * porPagina,
        take: porPagina,
        select: {
          id: true,
          nombre: true,
          telefono: true,
          ciudad: true,
          estado: true,
          pedidos: true,
          totalGastado: true,
          ultimoPedido: true,
          creado: true,
          fuenteCodigo: true,
          nivel: { select: { nombre: true } },
        },
      }),
    ]);

    const datos: ClienteAdminDto[] = filas.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      telefono: c.telefono,
      ciudad: c.ciudad,
      estado: c.estado,
      pedidos: c.pedidos,
      totalGastado: c.totalGastado.toNumber(),
      ultimoPedido: c.ultimoPedido?.toISOString() ?? null,
      creado: c.creado.toISOString(),
      fuenteCodigo: c.fuenteCodigo,
      nivel: c.nivel?.nombre ?? null,
    }));

    return { datos, total, pagina, porPagina };
  }

  private static aPerfil(c: ClientePerfil): PerfilDto {
    return {
      id: c.id,
      nombre: c.nombre,
      email: c.email,
      telefono: c.telefono,
      fechaNacimiento: c.fechaNacimiento?.toISOString() ?? null,
      quienRecibe: c.quienRecibe,
      direccion: {
        calle: c.calle,
        colonia: c.colonia,
        cp: c.cp,
        ciudad: c.ciudad,
        estado: c.estado,
        referencias: c.referencias,
        lat: c.lat,
        lng: c.lng,
      },
      notificaciones: c.notificaciones,
      pedidos: c.pedidos,
      totalGastado: c.totalGastado.toNumber(),
      primerPedido: c.primerPedido?.toISOString() ?? null,
      ultimoPedido: c.ultimoPedido?.toISOString() ?? null,
      creado: c.creado.toISOString(),
    };
  }
}
