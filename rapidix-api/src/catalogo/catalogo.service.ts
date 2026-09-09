import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Producto } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriasService } from './categorias.service';
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
  agotado: boolean;
  /** Existencia fisica en bodega. La mueve Inventario, no esta pantalla. */
  inventario: number;
  /** Lo liberado para venta: es el saldo del que descuenta un pedido. */
  aptInventario: number;
}

export interface CategoriaConProductos {
  categoria: string;
  productos: ProductoDto[];
}

/**
 * La categoria vive en su propia tabla, pero hacia fuera sigue viajando como
 * el nombre suelto que espera la Tienda: quien consume la API no tiene por que
 * enterarse de que por dentro es una relacion.
 */
type ProductoConCategoria = Producto & { categoria: { nombre: string } };

@Injectable()
export class CatalogoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categorias: CategoriasService,
  ) {}

  /**
   * Los precios se guardan como Decimal para que las sumas del pedido no
   * arrastren error de coma flotante. Hacia fuera viajan como numero: el
   * calculo del total lo hace siempre el backend (paso 19), nunca el cliente.
   */
  private static aDto(p: ProductoConCategoria): ProductoDto {
    return {
      id: p.id,
      nombre: p.nombre,
      categoria: p.categoria.nombre,
      unidad: p.unidad,
      precioCosto: p.precioCosto.toNumber(),
      precioVenta: p.precioVenta.toNumber(),
      imagenUrl: p.imagenUrl,
      agotado: p.agotado,
      inventario: p.inventario,
      aptInventario: p.aptInventario,
    };
  }

  /** Catalogo agrupado por categoria, como lo pinta la Tienda (Word 4.3). */
  async listarAgrupado(filtros: BuscarProductosDto): Promise<CategoriaConProductos[]> {
    const where: Prisma.ProductoWhereInput = {};
    if (filtros.q?.trim()) {
      where.nombre = { contains: filtros.q.trim(), mode: 'insensitive' };
    }
    if (filtros.categoria?.trim()) {
      where.categoria = { nombre: { equals: filtros.categoria.trim(), mode: 'insensitive' } };
    }

    const productos = await this.prisma.producto.findMany({
      where,
      include: { categoria: { select: { nombre: true } } },
      orderBy: [{ categoria: { nombre: 'asc' } }, { nombre: 'asc' }],
    });

    const grupos = new Map<string, ProductoDto[]>();
    for (const producto of productos) {
      const lista = grupos.get(producto.categoria.nombre) ?? [];
      lista.push(CatalogoService.aDto(producto));
      grupos.set(producto.categoria.nombre, lista);
    }

    return [...grupos.entries()].map(([categoria, items]) => ({ categoria, productos: items }));
  }

  /**
   * Catalogo de categorias (Word 4.9.3). Sale de su tabla, no de los productos:
   * una categoria que se quedo sin productos sigue existiendo y sigue siendo
   * elegible en una campania.
   */
  listarCategorias(): Promise<string[]> {
    return this.categorias.listarNombres();
  }

  async obtener(id: string): Promise<ProductoDto> {
    const producto = await this.prisma.producto.findUnique({
      where: { id },
      include: { categoria: { select: { nombre: true } } },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    return CatalogoService.aDto(producto);
  }

  /**
   * Alta manual (Word 6.6). La categoria se escribe como texto y el catalogo la
   * absorbe: si ya existe se reutiliza, y si no, queda dada de alta para la
   * siguiente vez y para las campanias de cupones.
   */
  async crear(dto: CrearProductoDto): Promise<ProductoDto> {
    const categoriaId = await this.categorias.resolver(dto.categoria);
    const producto = await this.prisma.producto.create({
      data: {
        nombre: dto.nombre.trim(),
        categoriaId,
        unidad: dto.unidad?.trim() || 'pza',
        precioCosto: dto.precioCosto ?? 0,
        precioVenta: dto.precioVenta,
        imagenUrl: dto.imagenUrl ?? null,
        agotado: dto.agotado ?? false,
      },
      include: { categoria: { select: { nombre: true } } },
    });
    return CatalogoService.aDto(producto);
  }

  async actualizar(id: string, dto: ActualizarProductoDto): Promise<ProductoDto> {
    await this.obtener(id);
    const categoriaId =
      dto.categoria !== undefined ? await this.categorias.resolver(dto.categoria) : undefined;
    const producto = await this.prisma.producto.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined && { nombre: dto.nombre.trim() }),
        ...(categoriaId !== undefined && { categoriaId }),
        ...(dto.unidad !== undefined && { unidad: dto.unidad.trim() }),
        ...(dto.precioCosto !== undefined && { precioCosto: dto.precioCosto }),
        ...(dto.precioVenta !== undefined && { precioVenta: dto.precioVenta }),
        ...(dto.imagenUrl !== undefined && { imagenUrl: dto.imagenUrl }),
      },
      include: { categoria: { select: { nombre: true } } },
    });
    return CatalogoService.aDto(producto);
  }

  /** Interruptor "Agotado" del catalogo. Efecto inmediato en la Tienda. */
  async marcarAgotado(id: string, dto: MarcarAgotadoDto): Promise<ProductoDto> {
    await this.obtener(id);
    const producto = await this.prisma.producto.update({
      where: { id },
      data: { agotado: dto.agotado },
      include: { categoria: { select: { nombre: true } } },
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
