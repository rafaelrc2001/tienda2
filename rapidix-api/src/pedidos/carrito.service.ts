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
  Producto,
  TipoDescuento,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CashbackService } from '../cashback/cashback.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { ahorro, precioListaAnterior, precioUnitario, upsell, Upsell } from '../catalogo/precios';
import { LineaCarritoDto, PrevisualizarCarritoDto } from './dto/carrito.dto';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

type ProductoConCategoria = Producto & { categoria: { nombre: string } };

export interface LineaResuelta {
  productoId: string;
  nombre: string;
  categoria: string;
  unidad: string;
  /** Precio escalonado segun la cantidad de la linea (HU-08). */
  precioUnitario: Decimal;
  cantidad: number;
  importe: Decimal;
  /** El producto suma a la base del cashback (HU-12). */
  aplicaCashback: boolean;
  /** Precio de la lista anterior, para tacharlo. Null en la primera lista. */
  precioLista: Decimal | null;
  /** Lo que se ahorra frente al precio de venta. */
  ahorro: Decimal;
  /** Oferta de subir a la siguiente lista (HU-10). */
  upsell: Upsell | null;
}

export interface CarritoResuelto {
  lineas: LineaResuelta[];
  subtotal: Decimal;
  /** Lo que suman las lineas que participan en el cashback. No es el subtotal. */
  baseCashback: Decimal;
  categorias: string[];
}

/**
 * Lo que le falta al carrito para ganar algo mas. La Tienda lo pinta en la
 * barra de compra para que el cliente no tenga que llegar al carrito para
 * enterarse (HU-20 y huecos del catalogo).
 */
export interface MetasCarrito {
  /** Lo que falta para el envio gratis. Null si ya lo tiene o no hay nada. */
  faltaEnvioGratis: number | null;
  /**
   * Lo que falta para activar el cashback. Solo cuando ya se lleva el 80 %
   * del minimo: a quien lleva $100 de $600 no le dice nada.
   */
  faltaCashback: number | null;
  /** Hay productos, pero ninguno participa en el cashback. */
  sinCashback: boolean;
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
  /** Cashback base, sin el x2 de la billetera. Es el que ve el cliente. */
  cashback: Decimal;
  /** Lo que se acredita: la base por `multiplicadorCashback`. */
  cashbackBilletera: Decimal;
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
  baseCashback: Decimal;
  categorias: string[];
  avisos: string[];
}

/**
 * Precio escalonado de una linea, tal como lo pinta la tarjeta de la Tienda
 * (HU-08 y HU-10). Viaja ya calculado: la interfaz no conoce las listas.
 */
export interface PrecioLineaDto {
  /** Precio de la lista anterior, tachado. Null en la primera lista. */
  precioLista: number | null;
  /** "Ahorras", frente al precio de venta. */
  ahorro: number;
  /** "Te faltan N". Null cuando no toca ofrecerlo. */
  upsell: { faltan: number; precioSiguiente: number; ahorro: number } | null;
}

/** Respuesta de POST /carrito/previsualizar. */
export interface PrevisualizacionCarritoDto {
  items: (PrecioLineaDto & {
    productoId: string;
    nombre: string;
    unidad: string;
    precioUnitario: number;
    cantidad: number;
    importe: number;
    /** El producto se agoto despues de meterlo al carrito. */
    agotado: boolean;
  })[];
  subtotal: number;
  envio: number;
  recargoFuera: number;
  descuento: number;
  total: number;
  /** Cashback base, sin el x2 de la billetera (HU-12). */
  cashbackEstimado: number;
  cupon: { codigo: string; descripcion: string } | null;
  dentroDeHorario: boolean;
  /** false si no se puede confirmar el pedido tal y como esta el carrito. */
  puedePedir: boolean;
  metas: MetasCarrito;
  avisos: string[];
}

/**
 * Respuesta de POST /carrito/subtotal.
 *
 * Es lo que necesita la barra de compra de la Tienda: lo que suman los
 * productos, el cashback estimado y lo que falta para el envio gratis, sin
 * envio, sin recargo y sin cupon. Va aparte de `previsualizar` porque no
 * necesita saber quien pregunta: el visitante sin sesion tambien ve su total
 * mientras arma el carrito.
 */
export interface SubtotalCarritoDto {
  items: (PrecioLineaDto & {
    productoId: string;
    /** El widget "Mi carrito" del header pinta "N x Producto" tambien al visitante. */
    nombre: string;
    unidad: string;
    precioUnitario: number;
    cantidad: number;
    importe: number;
    agotado: boolean;
  })[];
  subtotal: number;
  /** Cashback base con el % del nivel de entrada: el visitante no tiene nivel. */
  cashbackEstimado: number;
  /** Null con el carrito vacio: no hay nada que medir. */
  metas: MetasCarrito | null;
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
    private readonly cashback: CashbackService,
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

    const lineas = productos.map((p) => CarritoService.lineaDe(p, cantidades.get(p.id) as number));

    return {
      lineas,
      subtotal: CarritoService.sumar(lineas),
      baseCashback: CarritoService.baseCashbackDe(lineas),
      categorias: [...new Set(lineas.map((l) => l.categoria))],
    };
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
      const linea = CarritoService.lineaDe(p, cantidades.get(p.id) as number);
      if (p.agotado) {
        agotadas.push(linea);
        avisos.push(`${p.nombre} ya no está disponible`);
      } else {
        disponibles.push(linea);
      }
    }

    return {
      disponibles,
      agotadas,
      subtotal: CarritoService.sumar(disponibles),
      baseCashback: CarritoService.baseCashbackDe(disponibles),
      categorias: [...new Set(disponibles.map((l) => l.categoria))],
      avisos,
    };
  }

  /**
   * Lo que suman los productos del carrito, con su precio escalonado, el
   * cashback que dejarian y lo que falta para el envio gratis (HU-11 y HU-12).
   *
   * Es la barra de compra de la Tienda, y se calcula aqui por la misma razon
   * que todo lo demas: los precios no viajan desde el navegador. Aunque el
   * cliente pudiera sumar lo que tiene en pantalla, ese numero quedaria
   * obsoleto en cuanto cambiara un precio, y el de la Tienda tiene que ser el
   * mismo que luego cobra el carrito.
   *
   * No sabe quien pregunta, asi que el cashback se estima con el % del nivel
   * de entrada: es justo el que ganaria el visitante si comprara hoy.
   *
   * Un carrito vacio no es un error: vale cero.
   */
  async subtotalDe(items: LineaCarritoDto[]): Promise<SubtotalCarritoDto> {
    if (items.length === 0) {
      return { items: [], subtotal: 0, cashbackEstimado: 0, metas: null, avisos: [] };
    }

    const [carrito, config, porcentaje] = await Promise.all([
      this.resolverTolerante(items),
      this.configuracion.obtener(),
      this.cashback.porcentajePara(),
    ]);
    const aItem = (l: LineaResuelta, agotado: boolean): SubtotalCarritoDto['items'][0] => ({
      productoId: l.productoId,
      nombre: l.nombre,
      unidad: l.unidad,
      precioUnitario: l.precioUnitario.toNumber(),
      cantidad: l.cantidad,
      importe: l.importe.toNumber(),
      agotado,
      ...CarritoService.aPrecioLinea(l),
    });

    return {
      items: [
        ...carrito.disponibles.map((l) => aItem(l, false)),
        ...carrito.agotadas.map((l) => aItem(l, true)),
      ],
      subtotal: carrito.subtotal.toNumber(),
      cashbackEstimado: CashbackService.calcular(
        carrito.baseCashback,
        porcentaje,
        config.montoMinimoCashback,
      ).toNumber(),
      metas: CarritoService.metas(carrito.subtotal, carrito.baseCashback, config),
      avisos: carrito.avisos,
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
    const [config, porcentaje] = await Promise.all([
      this.configuracion.obtener(),
      this.cashback.porcentajePara(clienteId),
    ]);
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
        baseCashback: carrito.baseCashback,
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
      carrito,
      config,
      dentroDeHorario,
      porcentaje,
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
      ...CarritoService.aPrecioLinea(l),
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
      metas: CarritoService.metas(carrito.subtotal, carrito.baseCashback, config),
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
   *
   * `porcentajeCashback` es el del nivel de quien compra mas su bono
   * (`CashbackService.porcentajePara`): no es de la configuracion.
   */
  static calcularCarrito(
    carrito: Pick<CarritoResuelto, 'subtotal' | 'baseCashback'>,
    config: ConfiguracionNegocio,
    dentroDeHorario: boolean,
    porcentajeCashback: Decimal,
    descuento: Decimal = new Decimal(0),
  ): DesgloseCarrito {
    const { subtotal } = carrito;

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
      carrito.baseCashback,
      porcentajeCashback,
      config.montoMinimoCashback,
    );

    return {
      subtotal,
      envio,
      recargoFuera,
      descuento,
      total: total.lessThan(0) ? new Decimal(0) : total,
      cashback,
      cashbackBilletera: CashbackService.aBilletera(cashback, config.multiplicadorCashback),
    };
  }

  /**
   * Lo que le falta al carrito para el envio gratis y para el cashback.
   *
   * Vive junto a `calcularCarrito` porque mide contra las mismas fronteras:
   * envio gratis con `>=` sobre el subtotal, cashback con `>` estricto sobre la
   * base participante. Si una cambia alli, tiene que cambiar aqui.
   */
  static metas(
    subtotal: Decimal,
    baseCashback: Decimal,
    config: ConfiguracionNegocio,
  ): MetasCarrito {
    const hayAlgo = subtotal.greaterThan(0);
    const faltaEnvio = new Decimal(config.montoEnvioGratis).sub(subtotal);

    // Mismo 80 % que el upsell: el aviso sale cuando lo que falta, por cinco,
    // no pasa del minimo. Con la base justo en el minimo todavia no hay
    // cashback (`>` estricto): falta un centavo, y decir "te faltan $0.00"
    // seria mentir.
    const minimo = new Decimal(config.montoMinimoCashback);
    const faltaMinimo = minimo.sub(baseCashback);
    const cerca =
      baseCashback.greaterThan(0) &&
      !baseCashback.greaterThan(minimo) &&
      faltaMinimo.mul(5).lessThanOrEqualTo(minimo);

    return {
      faltaEnvioGratis: hayAlgo && faltaEnvio.greaterThan(0) ? faltaEnvio.toNumber() : null,
      faltaCashback: cerca ? Decimal.max(faltaMinimo, 0.01).toNumber() : null,
      sinCashback: hayAlgo && baseCashback.isZero(),
    };
  }

  /** Una linea del carrito, valorada a precio escalonado. */
  private static lineaDe(p: ProductoConCategoria, cantidad: number): LineaResuelta {
    const precio = precioUnitario(p, cantidad);
    return {
      productoId: p.id,
      nombre: p.nombre,
      categoria: p.categoria.nombre,
      unidad: p.unidad,
      precioUnitario: precio,
      cantidad,
      importe: precio.mul(cantidad),
      aplicaCashback: p.aplicaCashback,
      precioLista: precioListaAnterior(p, cantidad),
      ahorro: ahorro(p, cantidad),
      upsell: upsell(p, cantidad),
    };
  }

  private static sumar(lineas: LineaResuelta[]): Decimal {
    return lineas.reduce((s, l) => s.add(l.importe), new Decimal(0));
  }

  private static baseCashbackDe(lineas: LineaResuelta[]): Decimal {
    return CarritoService.sumar(lineas.filter((l) => l.aplicaCashback));
  }

  private static aPrecioLinea(l: LineaResuelta): PrecioLineaDto {
    return {
      precioLista: l.precioLista?.toNumber() ?? null,
      ahorro: l.ahorro.toNumber(),
      upsell: l.upsell
        ? {
            faltan: l.upsell.faltan,
            precioSiguiente: l.upsell.precioSiguiente.toNumber(),
            ahorro: l.upsell.ahorro.toNumber(),
          }
        : null,
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
