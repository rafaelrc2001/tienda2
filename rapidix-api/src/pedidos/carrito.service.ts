import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConfiguracionNegocio,
  CuponEmitido,
  EstadoCupon,
  OrigenCupon,
  Prisma,
  TipoDescuento,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CashbackService } from '../cashback/cashback.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { LineaCarritoDto, PrevisualizarCarritoDto } from './dto/carrito.dto';

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

/**
 * Desglose de dinero de un carrito. Es lo que se cobra y tambien lo que se
 * previsualiza: `POST /pedidos` y `POST /carrito/previsualizar` salen los dos
 * de `CarritoService.calcularCarrito`, para que no puedan divergir.
 */
export interface DesgloseCarrito {
  subtotal: Decimal;
  envio: Decimal;
  recargoFuera: Decimal;
  descuento: Decimal;
  total: Decimal;
  cashback: Decimal;
}

/**
 * Carrito resuelto de forma tolerante, para previsualizar.
 *
 * A diferencia de `resolver`, esto no lanza: las lineas que ya no se pueden
 * comprar se marcan y se explican, porque el cliente necesita ver su carrito
 * para poder arreglarlo.
 */
export interface CarritoTolerante {
  /** Lineas comprables. Son las unicas que suman al subtotal. */
  disponibles: LineaResuelta[];
  /** Lineas que siguen en el carrito pero ya no se pueden pedir. */
  agotadas: LineaResuelta[];
  subtotal: Decimal;
  categorias: string[];
  avisos: string[];
}

/** Respuesta de POST /carrito/previsualizar. */
export interface PrevisualizacionCarritoDto {
  items: {
    productoId: string;
    nombre: string;
    unidad: string;
    precioUnitario: number;
    cantidad: number;
    importe: number;
    /** El producto se agoto despues de meterlo al carrito. */
    agotado: boolean;
  }[];
  subtotal: number;
  envio: number;
  recargoFuera: number;
  descuento: number;
  total: number;
  cashbackEstimado: number;
  cupon: { codigo: string; descripcion: string } | null;
  dentroDeHorario: boolean;
  /** false si no se puede confirmar el pedido tal y como esta el carrito. */
  puedePedir: boolean;
  avisos: string[];
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracion: ConfiguracionService,
  ) {}

  /**
   * Resuelve el carrito contra la base de datos.
   *
   * Los precios NUNCA vienen del cliente: llegan solo `productoId` y
   * `cantidad`, y el importe se calcula aqui. Con Decimal, no con numeros de
   * coma flotante.
   */
  async resolver(items: LineaCarritoDto[]): Promise<CarritoResuelto> {
    const ids = [...new Set(items.map((i) => i.productoId))];
    const productos = await this.prisma.producto.findMany({
      where: { id: { in: ids } },
      include: { categoria: { select: { nombre: true } } },
    });

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
        categoria: p.categoria.nombre,
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
   * Igual que `resolver`, pero sin lanzar: es lo que necesita la
   * previsualizacion del carrito.
   *
   * DECISION DEL SPEC 02: una linea agotada NO suma al subtotal. Se sigue
   * mostrando, marcada y con su aviso, pero el total que ve el cliente es el
   * que pagaria al quitarla; ensenarle un numero que la API va a rechazar con
   * un 409 no le sirve de nada. Un producto borrado de la base desaparece de
   * la lista y deja solo su aviso.
   */
  async resolverTolerante(items: LineaCarritoDto[]): Promise<CarritoTolerante> {
    const ids = [...new Set(items.map((i) => i.productoId))];
    const productos = await this.prisma.producto.findMany({
      where: { id: { in: ids } },
      include: { categoria: { select: { nombre: true } } },
    });

    const avisos: string[] = [];
    const faltantes = ids.filter((id) => !productos.some((p) => p.id === id));
    if (faltantes.length > 0) {
      avisos.push(
        faltantes.length === 1
          ? 'Un producto de tu carrito ya no está disponible y lo quitamos.'
          : `${faltantes.length} productos de tu carrito ya no están disponibles y los quitamos.`,
      );
    }

    const cantidades = new Map<string, number>();
    for (const item of items) {
      cantidades.set(item.productoId, (cantidades.get(item.productoId) ?? 0) + item.cantidad);
    }

    const disponibles: LineaResuelta[] = [];
    const agotadas: LineaResuelta[] = [];
    for (const p of productos) {
      const cantidad = cantidades.get(p.id) as number;
      const linea: LineaResuelta = {
        productoId: p.id,
        nombre: p.nombre,
        categoria: p.categoria.nombre,
        unidad: p.unidad,
        precioUnitario: p.precioVenta,
        cantidad,
        importe: p.precioVenta.mul(cantidad),
      };
      if (p.agotado) {
        agotadas.push(linea);
        avisos.push(`${p.nombre} ya no está disponible`);
      } else {
        disponibles.push(linea);
      }
    }

    const subtotal = disponibles.reduce((s, l) => s.add(l.importe), new Decimal(0));
    return {
      disponibles,
      agotadas,
      subtotal,
      categorias: [...new Set(disponibles.map((l) => l.categoria))],
      avisos,
    };
  }

  /**
   * Valida un cupon contra un carrito, en el mismo orden que el prototipo.
   *
   * Devuelve un resultado en vez de lanzar: el checkout necesita mostrar el
   * motivo al cliente, no un error. El paso 19 lo convierte en excepcion
   * cuando el pedido se confirma de verdad.
   */
  async validarCupon(
    duenioId: string,
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
    // El cupon de bienvenida se emite antes de la primera compra, cuando su
    // dueno todavia es un prospecto: entonces cuelga de `prospectoId` y no de
    // `clienteId`. Vale cualquiera de las dos columnas.
    if (cupon.clienteId !== duenioId && cupon.prospectoId !== duenioId) {
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

    /**
     * Base sobre la que se miden el minimo, el maximo y el descuento.
     *
     * Sin restriccion de categorias es el subtotal entero. Con ellas es solo
     * lo que suman las lineas de esas categorias: un cupon de "Frutas y
     * verduras" con minimo de $100 no puede darse por cumplido porque el
     * carrito llegue a $100 comprando carne. Siempre antes del descuento.
     */
    let base = subtotal;
    let categoriasCupon: string[] = [];

    if (cupon.sourceKind === OrigenCupon.CAMPAIGN) {
      const campania = await this.prisma.campania.findUnique({ where: { name: cupon.sourceCode } });

      // Restriccion por categoria (Word 5, regla 10). Las categorias son las
      // que traen los propios productos, no una lista fija.
      if (campania && campania.categorias.length > 0) {
        categoriasCupon = campania.categorias;
        const coincide = carrito.categorias.some((c) => categoriasCupon.includes(c));
        if (!coincide) {
          return this.rechazo(
            'CATEGORIA_NO_APLICA',
            `Este cupón solo aplica en: ${categoriasCupon.join(', ')}`,
            subtotal,
          );
        }
        base = carrito.lineas
          .filter((l) => categoriasCupon.includes(l.categoria))
          .reduce((s, l) => s.add(l.importe), new Decimal(0));
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

    // El minimo y el maximo se evaluan sobre `base` y SIEMPRE antes del
    // descuento (Word 5, regla 3). El mensaje dice cuanto falta y, si el cupon
    // esta atado a categorias, sobre que se esta midiendo.
    const enCategorias = categoriasCupon.length > 0 ? ` en ${categoriasCupon.join(', ')}` : '';

    if (base.lessThan(cupon.minimumOrderAmount)) {
      const falta = new Decimal(cupon.minimumOrderAmount).sub(base);
      return this.rechazo(
        'MINIMO_NO_ALCANZADO',
        `Te faltan $${falta.toFixed(2)}${enCategorias} para llegar al mínimo de $${new Decimal(
          cupon.minimumOrderAmount,
        ).toFixed(2)} (el mínimo se evalúa antes del descuento)`,
        subtotal,
      );
    }
    if (cupon.maximumOrderAmount && base.greaterThan(cupon.maximumOrderAmount)) {
      return this.rechazo(
        'MAXIMO_SUPERADO',
        `Este cupón aplica hasta compras de $${new Decimal(cupon.maximumOrderAmount).toFixed(2)}${enCategorias}`,
        subtotal,
      );
    }

    // El descuento se calcula sobre la misma base que el minimo: un 20% de un
    // cupon de frutas descuenta el 20% de las frutas, no de todo el carrito.
    const descuento = CarritoService.calcularDescuento(cupon, base);
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
   * Desglose del carrito antes de confirmar (Word 4.3).
   *
   * `POST /pedidos` sigue siendo quien manda: esto es informativo y puede
   * quedar obsoleto entre que se pinta y se confirma. Por eso comparte con el
   * checkout el mismo `calcularCarrito` y la misma validacion de cupon: si
   * ambos ven la misma base, dan el mismo numero.
   */
  async previsualizar(
    clienteId: string,
    dto: PrevisualizarCarritoDto,
  ): Promise<PrevisualizacionCarritoDto> {
    const config = await this.configuracion.obtener();
    const dentroDeHorario = ConfiguracionService.estaDentroDeHorario(config);

    const carrito = await this.resolverTolerante(dto.items);
    const avisos = [...carrito.avisos];

    if (!dentroDeHorario) {
      avisos.push(
        config.atenderFuera
          ? `Estás fuera del horario de servicio (${config.abre} a ${config.cierra}): tu pedido lleva un recargo del ${config.incrementoFuera.toString()} %.`
          : `Ahora mismo no estamos recibiendo pedidos. Nuestro horario es de ${config.abre} a ${config.cierra}.`,
      );
    }

    // El cupon se valida contra las lineas comprables, que son las que suman.
    let descuento = new Decimal(0);
    let cupon: PrevisualizacionCarritoDto['cupon'] = null;

    if (dto.codigoCupon && carrito.disponibles.length > 0) {
      const resultado = await this.validarCupon(clienteId, dto.codigoCupon, {
        lineas: carrito.disponibles,
        subtotal: carrito.subtotal,
        categorias: carrito.categorias,
      });
      if (resultado.valido) {
        descuento = new Decimal(resultado.descuento);
        cupon = { codigo: resultado.codigo, descripcion: resultado.titulo };
      } else {
        // El motivo se muestra en el campo del cupon, no como error de la
        // peticion: el resto del carrito se sigue pudiendo pedir.
        avisos.push(resultado.mensaje);
      }
    }

    const desglose = CarritoService.calcularCarrito(
      carrito.subtotal,
      config,
      dentroDeHorario,
      descuento,
    );

    const aItem = (l: LineaResuelta, agotado: boolean): PrevisualizacionCarritoDto['items'][0] => ({
      productoId: l.productoId,
      nombre: l.nombre,
      unidad: l.unidad,
      precioUnitario: l.precioUnitario.toNumber(),
      cantidad: l.cantidad,
      importe: l.importe.toNumber(),
      agotado,
    });

    // DECISION DEL SPEC 02: una linea agotada tambien bloquea el pedido. El
    // boton de confirmar se apaga con el motivo a la vista, en vez de dejar
    // que el cliente choque con el 409 de POST /pedidos.
    const puedePedir =
      (dentroDeHorario || config.atenderFuera) &&
      carrito.agotadas.length === 0 &&
      carrito.disponibles.length > 0;

    return {
      items: [
        ...carrito.disponibles.map((l) => aItem(l, false)),
        ...carrito.agotadas.map((l) => aItem(l, true)),
      ],
      subtotal: desglose.subtotal.toNumber(),
      envio: desglose.envio.toNumber(),
      recargoFuera: desglose.recargoFuera.toNumber(),
      descuento: desglose.descuento.toNumber(),
      total: desglose.total.toNumber(),
      cashbackEstimado: desglose.cashback.toNumber(),
      cupon,
      dentroDeHorario,
      puedePedir,
      avisos,
    };
  }

  /**
   * Envio, recargo fuera de horario, total y cashback de un carrito.
   *
   * Unico sitio donde vive esta aritmetica. `PedidosService.crear` la llama
   * dentro de su transaccion y `POST /carrito/previsualizar` la llama sin
   * tocar nada: el numero que ve el cliente antes de confirmar es el mismo
   * que se cobra, salvo que la base cambie entre una llamada y otra.
   */
  static calcularCarrito(
    subtotal: Decimal,
    config: ConfiguracionNegocio,
    dentroDeHorario: boolean,
    descuento: Decimal = new Decimal(0),
  ): DesgloseCarrito {
    // Envio gratis segun el subtotal ANTES del descuento, igual que el
    // prototipo: el cupon no debe hacer perder el envio gratis.
    const envio = subtotal.greaterThanOrEqualTo(config.montoEnvioGratis)
      ? new Decimal(0)
      : new Decimal(config.costoEnvio);

    const recargoFuera = dentroDeHorario
      ? new Decimal(0)
      : subtotal.mul(config.incrementoFuera).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const total = subtotal
      .add(envio)
      .add(recargoFuera)
      .sub(descuento)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const cashback = CashbackService.calcular(
      subtotal,
      config.multiplicadorCashback,
      config.montoMinimoCashback,
    );

    return {
      subtotal,
      envio,
      recargoFuera,
      descuento,
      total: total.lessThan(0) ? new Decimal(0) : total,
      cashback,
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
    duenioId: string,
    codigo: string,
    carrito: CarritoResuelto,
  ): Promise<Extract<ResultadoCupon, { valido: true }>> {
    const resultado = await this.validarCupon(duenioId, codigo, carrito);
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
