import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CuponEmitido, EstadoCupon, OrigenCupon, Prisma, TipoDescuento } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LineaCarritoDto } from './dto/carrito.dto';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export interface LineaResuelta {
  productoId: string;
  nombre: string;
  categoria: string;
  unidad: string;
  precioUnitario: Decimal;
  cantidad: number;
  importe: Decimal;
}

export interface CarritoResuelto {
  lineas: LineaResuelta[];
  subtotal: Decimal;
  categorias: string[];
}

/** Por que se rechazo un cupon. Le sirve al frontend para el toast. */
export type MotivoRechazo =
  | 'NO_ENCONTRADO'
  | 'AJENO'
  | 'NO_DISPONIBLE'
  | 'VENCIDO'
  | 'MINIMO_NO_ALCANZADO'
  | 'MAXIMO_SUPERADO'
  | 'CATEGORIA_NO_APLICA'
  | 'LIMITE_AGOTADO';

export type ResultadoCupon =
  | {
      valido: true;
      cuponId: string;
      codigo: string;
      titulo: string;
      subtotal: number;
      descuento: number;
    }
  | { valido: false; motivo: MotivoRechazo; mensaje: string; subtotal: number };

@Injectable()
export class CarritoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resuelve el carrito contra la base de datos.
   *
   * Los precios NUNCA vienen del cliente: llegan solo `productoId` y
   * `cantidad`, y el importe se calcula aqui. Con Decimal, no con numeros de
   * coma flotante.
   */
  async resolver(items: LineaCarritoDto[]): Promise<CarritoResuelto> {
    const ids = [...new Set(items.map((i) => i.productoId))];
    const productos = await this.prisma.producto.findMany({ where: { id: { in: ids } } });

    const faltantes = ids.filter((id) => !productos.some((p) => p.id === id));
    if (faltantes.length > 0) {
      throw new NotFoundException(`Hay ${faltantes.length} producto(s) que ya no existen.`);
    }

    const agotados = productos.filter((p) => p.agotado);
    if (agotados.length > 0) {
      throw new ConflictException(
        `Estos productos están agotados: ${agotados.map((p) => p.nombre).join(', ')}.`,
      );
    }

    // Un mismo producto repetido en el cuerpo se acumula en una sola linea.
    const cantidades = new Map<string, number>();
    for (const item of items) {
      cantidades.set(item.productoId, (cantidades.get(item.productoId) ?? 0) + item.cantidad);
    }

    const lineas: LineaResuelta[] = productos.map((p) => {
      const cantidad = cantidades.get(p.id) as number;
      return {
        productoId: p.id,
        nombre: p.nombre,
        categoria: p.categoria,
        unidad: p.unidad,
        precioUnitario: p.precioVenta,
        cantidad,
        importe: p.precioVenta.mul(cantidad),
      };
    });

    const subtotal = lineas.reduce((s, l) => s.add(l.importe), new Decimal(0));
    return { lineas, subtotal, categorias: [...new Set(lineas.map((l) => l.categoria))] };
  }

  /**
   * Valida un cupon contra un carrito, en el mismo orden que el prototipo.
   *
   * Devuelve un resultado en vez de lanzar: el checkout necesita mostrar el
   * motivo al cliente, no un error. El paso 19 lo convierte en excepcion
   * cuando el pedido se confirma de verdad.
   */
  async validarCupon(
    clienteId: string,
    codigo: string,
    carrito: CarritoResuelto,
  ): Promise<ResultadoCupon> {
    const subtotal = carrito.subtotal;
    const nu = (d: Decimal): number => d.toNumber();

    const cupon = await this.prisma.cuponEmitido.findUnique({
      where: { code: codigo.trim().toUpperCase() },
    });

    if (!cupon) {
      return this.rechazo('NO_ENCONTRADO', 'Cupón no encontrado', subtotal);
    }
    if (cupon.clienteId !== clienteId) {
      return this.rechazo('AJENO', 'Este cupón no pertenece a tu cuenta', subtotal);
    }
    if (cupon.status !== EstadoCupon.ACTIVE) {
      return this.rechazo('NO_DISPONIBLE', 'Este cupón ya no está disponible', subtotal);
    }
    if (cupon.expiresAt < new Date()) {
      // Se marca vencido de paso: el job diario del paso 22 tambien lo haria,
      // pero no tiene sentido volver a ofrecerlo hasta que pase.
      await this.prisma.cuponEmitido.update({
        where: { id: cupon.id },
        data: { status: EstadoCupon.EXPIRED },
      });
      return this.rechazo('VENCIDO', 'Este cupón ya venció', subtotal);
    }

    // El minimo se evalua sobre el subtotal ANTES del descuento, y el mensaje
    // dice cuanto falta (Word 5, regla 3).
    if (subtotal.lessThan(cupon.minimumOrderAmount)) {
      const falta = new Decimal(cupon.minimumOrderAmount).sub(subtotal);
      return this.rechazo(
        'MINIMO_NO_ALCANZADO',
        `Te faltan $${falta.toFixed(2)} para llegar al mínimo de $${new Decimal(
          cupon.minimumOrderAmount,
        ).toFixed(2)} (el mínimo se evalúa antes del descuento)`,
        subtotal,
      );
    }
    if (cupon.maximumOrderAmount && subtotal.greaterThan(cupon.maximumOrderAmount)) {
      return this.rechazo(
        'MAXIMO_SUPERADO',
        `Este cupón aplica hasta compras de $${new Decimal(cupon.maximumOrderAmount).toFixed(2)}`,
        subtotal,
      );
    }

    if (cupon.sourceKind === OrigenCupon.CAMPAIGN) {
      const campania = await this.prisma.campania.findUnique({ where: { name: cupon.sourceCode } });

      // Restriccion por categoria (Word 5, regla 10).
      if (campania && campania.categorias.length > 0) {
        const coincide = carrito.categorias.some((c) => campania.categorias.includes(c));
        if (!coincide) {
          return this.rechazo(
            'CATEGORIA_NO_APLICA',
            `Este cupón solo aplica en: ${campania.categorias.join(', ')}`,
            subtotal,
          );
        }
      }

      // Limite total de usos de la campana (Word 4.9.2). El prototipo guarda
      // el campo pero nunca lo comprueba.
      if (campania && campania.usageLimitTotal > 0) {
        const usados = await this.prisma.cuponEmitido.count({
          where: {
            sourceKind: OrigenCupon.CAMPAIGN,
            sourceCode: campania.name,
            status: EstadoCupon.USED,
          },
        });
        if (usados >= campania.usageLimitTotal) {
          return this.rechazo(
            'LIMITE_AGOTADO',
            'Esta promoción alcanzó su límite de usos.',
            subtotal,
          );
        }
      }
    }

    const descuento = CarritoService.calcularDescuento(cupon, subtotal);
    return {
      valido: true,
      cuponId: cupon.id,
      codigo: cupon.code,
      titulo: cupon.title,
      subtotal: nu(subtotal),
      descuento: nu(descuento),
    };
  }

  /**
   * Descuento efectivo, acotado al subtotal.
   *
   * El tope es una decision del SPEC: sin el, un cupon de monto fijo mayor que
   * la compra se comeria tambien el envio. Con INACTIVITY (minimo 0, valor
   * 100) un pedido de $50 saldria gratis con reparto incluido.
   */
  static calcularDescuento(
    cupon: Pick<CuponEmitido, 'discountType' | 'discountValue'>,
    subtotal: Decimal,
  ): Decimal {
    const bruto =
      cupon.discountType === TipoDescuento.PERCENTAGE
        ? subtotal.mul(cupon.discountValue).div(100)
        : new Decimal(cupon.discountValue);
    const acotado = bruto.greaterThan(subtotal) ? subtotal : bruto;
    return acotado.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }

  private rechazo(motivo: MotivoRechazo, mensaje: string, subtotal: Decimal): ResultadoCupon {
    return { valido: false, motivo, mensaje, subtotal: subtotal.toNumber() };
  }

  /** Igual que `validarCupon`, pero lanza. Lo usa el checkout del paso 19. */
  async exigirCuponValido(
    clienteId: string,
    codigo: string,
    carrito: CarritoResuelto,
  ): Promise<Extract<ResultadoCupon, { valido: true }>> {
    const resultado = await this.validarCupon(clienteId, codigo, carrito);
    if (!resultado.valido) {
      throw new BadRequestException({
        statusCode: 400,
        code: resultado.motivo,
        message: resultado.mensaje,
      });
    }
    return resultado;
  }
}
