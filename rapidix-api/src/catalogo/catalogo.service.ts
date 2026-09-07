import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Producto } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ActualizarProductoDto,
  BuscarProductosDto,
  CrearProductoDto,
  MarcarAgotadoDto,
} from './dto/producto.dto';

/** Producto tal como sale por la API: los Decimal viajan como numero. */
export interface ProductoDto {
  id: string;
  nombre: string;
  categoria: string;
  unidad: string;
  precioCosto: number;
  precioVenta: number;
  imagenUrl: string | null;
  emoji: string | null;
  agotado: boolean;
}

export interface CategoriaConProductos {
  categoria: string;
  productos: ProductoDto[];
}

@Injectable()
export class CatalogoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Los precios se guardan como Decimal para que las sumas del pedido no
   * arrastren error de coma flotante. Hacia fuera viajan como numero: el
   * calculo del total lo hace siempre el backend (paso 19), nunca el cliente.
   */
  private static aDto(p: Producto): ProductoDto {
    return {
      id: p.id,
      nombre: p.nombre,
      categoria: p.categoria,
      unidad: p.unidad,
      precioCosto: p.precioCosto.toNumber(),
      precioVenta: p.precioVenta.toNumber(),
      imagenUrl: p.imagenUrl,
      emoji: p.emoji,
      agotado: p.agotado,
    };
  }

  /** Catalogo agrupado por categoria, como lo pinta la Tienda (Word 4.3). */
  async listarAgrupado(filtros: BuscarProductosDto): Promise<CategoriaConProductos[]> {
    const where: Prisma.ProductoWhereInput = {};
    if (filtros.q?.trim()) {
      where.nombre = { contains: filtros.q.trim(), mode: 'insensitive' };
    }
    if (filtros.categoria?.trim()) {
      where.categoria = { equals: filtros.categoria.trim(), mode: 'insensitive' };
    }

    const productos = await this.prisma.producto.findMany({
      where,
      orderBy: [{ categoria: 'asc' }, { nombre: 'asc' }],
    });

    const grupos = new Map<string, ProductoDto[]>();
    for (const producto of productos) {
      const lista = grupos.get(producto.categoria) ?? [];
      lista.push(CatalogoService.aDto(producto));
      grupos.set(producto.categoria, lista);
    }

    return [...grupos.entries()].map(([categoria, items]) => ({ categoria, productos: items }));
  }

  /**
   * Las categorias no son una tabla: se derivan de los productos dados de alta
   * (Word 4.9.3). Alimentan los chips de categoria de las campanias.
   */
  async listarCategorias(): Promise<string[]> {
    const filas = await this.prisma.producto.findMany({
      distinct: ['categoria'],
      select: { categoria: true },
      orderBy: { categoria: 'asc' },
    });
    return filas.map((f) => f.categoria);
  }

  async obtener(id: string): Promise<ProductoDto> {
    const producto = await this.prisma.producto.findUnique({ where: { id } });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    return CatalogoService.aDto(producto);
  }

  async crear(dto: CrearProductoDto): Promise<ProductoDto> {
    const producto = await this.prisma.producto.create({
      data: {
        nombre: dto.nombre.trim(),
        categoria: dto.categoria.trim(),
        unidad: dto.unidad?.trim() || 'pza',
        precioCosto: dto.precioCosto ?? 0,
        precioVenta: dto.precioVenta,
        imagenUrl: dto.imagenUrl ?? null,
        emoji: dto.emoji ?? null,
        agotado: dto.agotado ?? false,
      },
    });
    return CatalogoService.aDto(producto);
  }

  async actualizar(id: string, dto: ActualizarProductoDto): Promise<ProductoDto> {
    await this.obtener(id);
    const producto = await this.prisma.producto.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined && { nombre: dto.nombre.trim() }),
        ...(dto.categoria !== undefined && { categoria: dto.categoria.trim() }),
        ...(dto.unidad !== undefined && { unidad: dto.unidad.trim() }),
        ...(dto.precioCosto !== undefined && { precioCosto: dto.precioCosto }),
        ...(dto.precioVenta !== undefined && { precioVenta: dto.precioVenta }),
        ...(dto.imagenUrl !== undefined && { imagenUrl: dto.imagenUrl }),
        ...(dto.emoji !== undefined && { emoji: dto.emoji }),
      },
    });
    return CatalogoService.aDto(producto);
  }

  /** Interruptor "Agotado" del catalogo. Efecto inmediato en la Tienda. */
  async marcarAgotado(id: string, dto: MarcarAgotadoDto): Promise<ProductoDto> {
    await this.obtener(id);
    const producto = await this.prisma.producto.update({
      where: { id },
      data: { agotado: dto.agotado },
    });
    return CatalogoService.aDto(producto);
  }

  /**
   * Un producto que ya aparece en pedidos no se borra: eso reescribiria el
   * historial. Para retirarlo de la Tienda esta el interruptor de agotado.
   */
  async eliminar(id: string): Promise<void> {
    await this.obtener(id);
    const enPedidos = await this.prisma.pedidoItem.count({ where: { productoId: id } });
    if (enPedidos > 0) {
      throw new ConflictException(
        `Este producto aparece en ${enPedidos} pedido(s) y no puede eliminarse. Márcalo como agotado para retirarlo de la Tienda.`,
      );
    }
    await this.prisma.producto.delete({ where: { id } });
  }

  /**
   * Boton "Programar" de un producto agotado (Word 6.3): registra la intencion
   * de compra. Solo tiene sentido si el producto esta efectivamente agotado.
   */
  async programar(productoId: string, clienteId: string): Promise<{ registrado: true }> {
    const producto = await this.prisma.producto.findUnique({ where: { id: productoId } });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    if (!producto.agotado) {
      throw new BadRequestException('Este producto está disponible: agrégalo al carrito.');
    }
    await this.prisma.solicitudProducto.create({ data: { productoId, clienteId } });
    return { registrado: true };
  }
}
