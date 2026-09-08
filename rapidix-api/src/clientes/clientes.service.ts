import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ActualizarPerfilDto,
  BuscarClientesDto,
  ClienteAdminDto,
  PaginaClientesDto,
  PaginaProspectosDto,
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
  sucursal: true,
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

/**
 * Los mismos campos en `prospectos`. La tabla no lleva contadores de compra
 * porque un prospecto no ha comprado: se rellenan en cero al pintar el perfil.
 */
const SELECT_PERFIL_PROSPECTO = {
  id: true,
  nombre: true,
  email: true,
  telefono: true,
  fechaNacimiento: true,
  quienRecibe: true,
  sucursal: true,
  calle: true,
  colonia: true,
  cp: true,
  ciudad: true,
  estado: true,
  referencias: true,
  lat: true,
  lng: true,
  notificaciones: true,
  creado: true,
} satisfies Prisma.ProspectoSelect;

type ProspectoPerfil = Prisma.ProspectoGetPayload<{ select: typeof SELECT_PERFIL_PROSPECTO }>;

@Injectable()
export class ClientesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pantalla Perfil (Word 4.7).
   *
   * Vale igual para quien todavia no ha comprado: su perfil vive en
   * `prospectos` y se pinta con los contadores de compra en cero. Es la
   * pantalla donde escribe su direccion antes del primer pedido.
   */
  async perfil(duenioId: string): Promise<PerfilDto> {
    const cliente = await this.prisma.cliente.findUnique({
      where: { id: duenioId },
      select: SELECT_PERFIL,
    });
    if (cliente) return ClientesService.aPerfil(cliente);

    const prospecto = await this.prisma.prospecto.findUnique({
      where: { id: duenioId },
      select: SELECT_PERFIL_PROSPECTO,
    });
    if (!prospecto) {
      throw new NotFoundException('No encontramos tu perfil');
    }
    return ClientesService.aPerfilProspecto(prospecto);
  }

  /**
   * Guarda los datos editables del perfil.
   *
   * `telefono` no se toca: no esta en el DTO y `forbidNonWhitelisted` rechaza
   * el intento con un 400 antes de llegar aqui.
   */
  async actualizar(duenioId: string, cambios: ActualizarPerfilDto): Promise<PerfilDto> {
    const { fechaNacimiento, ...resto } = cambios;
    const datos = {
      ...resto,
      ...(fechaNacimiento !== undefined ? { fechaNacimiento: new Date(fechaNacimiento) } : {}),
    };

    if (await this.prisma.cliente.count({ where: { id: duenioId } })) {
      const cliente = await this.prisma.cliente.update({
        where: { id: duenioId },
        data: datos,
        select: SELECT_PERFIL,
      });
      return ClientesService.aPerfil(cliente);
    }

    // Todavia no ha comprado: lo que escriba se guarda en `prospectos` y viaja
    // al cliente cuando confirme su primer pedido.
    if (!(await this.prisma.prospecto.count({ where: { id: duenioId } }))) {
      throw new NotFoundException('No encontramos tu perfil');
    }
    const prospecto = await this.prisma.prospecto.update({
      where: { id: duenioId },
      data: datos,
      select: SELECT_PERFIL_PROSPECTO,
    });
    return ClientesService.aPerfilProspecto(prospecto);
  }

  /**
   * Administracion -> Prospectos: quien se registro y todavia no ha comprado.
   *
   * Es el listado para sacar registros. Ordena por fecha de registro, del mas
   * reciente al mas viejo: lo util aqui es a quien hay que ir a buscar.
   */
  async listarProspectosParaAdmin(filtros: BuscarClientesDto): Promise<PaginaProspectosDto> {
    const pagina = filtros.pagina ?? 1;
    const porPagina = filtros.porPagina ?? 25;

    const termino = filtros.q?.trim();
    const where: Prisma.ProspectoWhereInput = termino
      ? {
          OR: [
            { nombre: { contains: termino, mode: 'insensitive' } },
            { telefono: { contains: termino } },
          ],
        }
      : {};

    const [total, filas] = await Promise.all([
      this.prisma.prospecto.count({ where }),
      this.prisma.prospecto.findMany({
        where,
        orderBy: { creado: 'desc' },
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      }),
    ]);

    return {
      datos: filas.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        telefono: p.telefono,
        ciudad: p.ciudad,
        estado: p.estado,
        tieneDireccion: Boolean(p.calle?.trim()),
        fuenteCodigo: p.fuenteCodigo,
        creado: p.creado.toISOString(),
      })),
      total,
      pagina,
      porPagina,
    };
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
      sucursal: c.sucursal,
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

  /** El mismo perfil para un prospecto: sin historial de compra que mostrar. */
  private static aPerfilProspecto(p: ProspectoPerfil): PerfilDto {
    return {
      id: p.id,
      nombre: p.nombre,
      email: p.email,
      telefono: p.telefono,
      fechaNacimiento: p.fechaNacimiento?.toISOString() ?? null,
      quienRecibe: p.quienRecibe,
      sucursal: p.sucursal,
      direccion: {
        calle: p.calle,
        colonia: p.colonia,
        cp: p.cp,
        ciudad: p.ciudad,
        estado: p.estado,
        referencias: p.referencias,
        lat: p.lat,
        lng: p.lng,
      },
      notificaciones: p.notificaciones,
      pedidos: 0,
      totalGastado: 0,
      primerPedido: null,
      ultimoPedido: null,
      creado: p.creado.toISOString(),
    };
  }
}
