import { Injectable } from '@nestjs/common';
import { EstadoPago, RolProducto } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { TiendasService } from '../tiendas/tiendas.service';
import { CatalogoService, ProductoDto } from './catalogo.service';

/** Producto del catalogo con lo que este cliente ha hecho con el. */
export interface ProductoRecomendadoDto extends ProductoDto {
  /** Venia en el ultimo pedido del cliente. Es el badge de la tarjeta (HU-03). */
  ultimoComprado: boolean;
  /** En cuantos pedidos suyos ha aparecido. 0 para un visitante. */
  vecesComprado: number;
}

/** Una fila de la Tienda. */
export interface FamiliaRecomendadaDto {
  categoria: string;
  prioridad: number;
  /** La familia aparecia en el ultimo pedido: sube al bloque de arriba. */
  enUltimoPedido: boolean;
  productos: ProductoRecomendadoDto[];
}

export interface CatalogoRecomendadoDto {
  familias: FamiliaRecomendadaDto[];
  /**
   * El orden salio del historial de quien pregunta. `false` es el catalogo
   * plano del negocio: sin sesion, o con una sesion que todavia no ha comprado.
   */
  personalizado: boolean;
  /**
   * Si un pedido descuenta existencias. La Tienda solo topa la cantidad al
   * saldo cuando esta encendido: con el control apagado todos los productos
   * estan en cero y topar ahi seria no dejar comprar nada.
   *
   * Viendo una tienda va siempre encendido: su saldo entro por transferencias
   * aceptadas, no es el cero con el que nace la bodega, y el checkout de
   * recoger en tienda ya rechaza lo que el anaquel no tiene.
   */
  controlInventario: boolean;
  /**
   * De que tienda son las existencias (`aptInventario`, `agotado`). Null =
   * bodega: no se pidio tienda o la pedida ya no esta activa.
   */
  tiendaId: string | null;
}

/**
 * Peso de cada rol al desempatar. Es el orden del HU-01:
 * Destino > Rutina > Estacional > Conveniencia.
 */
const PESO_ROL: Readonly<Record<RolProducto, number>> = {
  [RolProducto.DESTINO]: 0,
  [RolProducto.RUTINA]: 1,
  [RolProducto.ESTACIONAL]: 2,
  [RolProducto.CONVENIENCIA]: 3,
};

/** Lo que el cliente ha comprado, resumido para ordenar. */
interface HistorialCliente {
  /** Productos del ultimo pedido. */
  ultimoPedido: Set<string>;
  /** productoId -> en cuantos pedidos aparecio. */
  frecuencia: Map<string, number>;
}

const SIN_HISTORIAL: HistorialCliente = { ultimoPedido: new Set(), frecuencia: new Map() };

/**
 * El catalogo ordenado a la medida de quien pregunta (HU-01 y HU-02).
 *
 * Vive aparte de `CatalogoService` porque no es la misma pregunta: aquel
 * responde "que se vende", este "en que orden se lo enseno a esta persona". El
 * orden depende del historial del cliente, y eso ya no es catalogo.
 *
 * El criterio entero esta en `compararFamilias` y `compararProductos`, que son
 * funciones puras: se pueden leer y probar sin base de datos, que es justo lo
 * que hace falta cuando el negocio pregunte por que un producto sale tercero.
 */
@Injectable()
export class RecomendacionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracion: ConfiguracionService,
    private readonly tiendas: TiendasService,
  ) {}

  /**
   * Orden de las familias.
   *
   * Primero las del ultimo pedido —a lo que ya compraste no deberias tener que
   * bajar— y dentro de cada bloque, la prioridad que fijo el negocio. El nombre
   * solo desempata entre familias con la misma prioridad, que es el caso de
   * todas las que nadie ha priorizado todavia.
   */
  static compararFamilias(a: FamiliaRecomendadaDto, b: FamiliaRecomendadaDto): number {
    if (a.enUltimoPedido !== b.enUltimoPedido) return a.enUltimoPedido ? -1 : 1;
    if (a.prioridad !== b.prioridad) return a.prioridad - b.prioridad;
    return a.categoria.localeCompare(b.categoria, 'es');
  }

  /**
   * Orden dentro de una fila.
   *
   * Lo agotado se va al final antes que nada: encabezar una fila con algo que
   * no se puede comprar gasta el mejor sitio de la pantalla. Despues manda el
   * historial —lo del ultimo pedido, luego lo que mas veces ha comprado— y solo
   * cuando el cliente no dice nada entra el criterio del negocio, que es el
   * rol. El id cierra el desempate para que dos cargas seguidas den el mismo
   * orden.
   */
  static compararProductos(a: ProductoRecomendadoDto, b: ProductoRecomendadoDto): number {
    if (a.agotado !== b.agotado) return a.agotado ? 1 : -1;
    if (a.ultimoComprado !== b.ultimoComprado) return a.ultimoComprado ? -1 : 1;
    if (a.vecesComprado !== b.vecesComprado) return b.vecesComprado - a.vecesComprado;
    if (PESO_ROL[a.rol] !== PESO_ROL[b.rol]) return PESO_ROL[a.rol] - PESO_ROL[b.rol];
    return a.id.localeCompare(b.id);
  }

  /**
   * Arma el catalogo ordenado.
   *
   * `clienteId` llega solo cuando la peticion trae un token valido de cliente.
   * Sin el sale el mismo catalogo para todo el mundo, ordenado por la prioridad
   * de cada familia: es el caso del visitante que todavia no ha entrado.
   *
   * Con `tiendaId` las existencias son las de esa tienda: quien recoge se
   * lleva lo que hay en su anaquel, no lo de bodega. Lo que alli esta en cero
   * viaja agotado, aunque en bodega sobre, y por eso se va al final de su fila.
   */
  async catalogoPara(clienteId?: string, tiendaId?: string): Promise<CatalogoRecomendadoDto> {
    const [productos, config, historial, tienda] = await Promise.all([
      this.prisma.producto.findMany({
        where: { eliminadoEn: null },
        include: { categoria: { select: { nombre: true, prioridad: true } } },
      }),
      this.configuracion.obtener(),
      clienteId ? this.historialDe(clienteId) : Promise.resolve(SIN_HISTORIAL),
      this.tiendas.activa(tiendaId),
    ]);
    const enTienda = tienda ? await this.tiendas.disponibles(tienda.id) : null;

    // Una familia existe en la Tienda si tiene productos. Las categorias vacias
    // siguen en el catalogo —las campanias de cupones restringen por ellas—
    // pero no pintan una fila vacia en la pantalla del cliente.
    const familias = new Map<string, FamiliaRecomendadaDto>();

    for (const producto of productos) {
      const nombre = producto.categoria.nombre;
      const familia = familias.get(nombre) ?? {
        categoria: nombre,
        prioridad: producto.categoria.prioridad,
        enUltimoPedido: false,
        productos: [],
      };

      const ultimoComprado = historial.ultimoPedido.has(producto.id);
      const dto = CatalogoService.aDto(producto);
      if (enTienda) {
        const hay = enTienda.get(producto.id) ?? 0;
        dto.aptInventario = hay;
        dto.agotado = dto.agotado || hay <= 0;
      }
      familia.productos.push({
        ...dto,
        ultimoComprado,
        vecesComprado: historial.frecuencia.get(producto.id) ?? 0,
      });
      if (ultimoComprado) familia.enUltimoPedido = true;

      familias.set(nombre, familia);
    }

    const ordenadas = [...familias.values()];
    for (const familia of ordenadas) {
      familia.productos.sort(RecomendacionesService.compararProductos);
    }
    ordenadas.sort(RecomendacionesService.compararFamilias);

    return {
      familias: ordenadas,
      personalizado: historial.frecuencia.size > 0,
      controlInventario: tienda ? true : config.controlInventario,
      tiendaId: tienda?.id ?? null,
    };
  }

  /**
   * Lo que este cliente ha comprado.
   *
   * Los pedidos cancelados no cuentan: no llegaron a entregarse y no dicen nada
   * de lo que la persona consume. `clienteId` puede ser el de un prospecto, que
   * por definicion no tiene pedidos: la consulta devuelve vacio y el catalogo
   * sale sin personalizar, que es lo correcto.
   */
  private async historialDe(clienteId: string): Promise<HistorialCliente> {
    const noCancelado = { clienteId, estadoPago: { not: EstadoPago.CANCELADO } };

    const [ultimo, frecuencias] = await Promise.all([
      this.prisma.pedido.findFirst({
        where: noCancelado,
        orderBy: { creadoEn: 'desc' },
        // Un renglon en cero es algo que no acepto en la puerta: no lo consume.
        select: { items: { where: { cantidad: { gt: 0 } }, select: { productoId: true } } },
      }),
      this.prisma.pedidoItem.groupBy({
        by: ['productoId'],
        where: { pedido: noCancelado, cantidad: { gt: 0 } },
        _count: { _all: true },
      }),
    ]);

    return {
      ultimoPedido: new Set(ultimo?.items.map((i) => i.productoId) ?? []),
      frecuencia: new Map(frecuencias.map((f) => [f.productoId, f._count._all])),
    };
  }
}
