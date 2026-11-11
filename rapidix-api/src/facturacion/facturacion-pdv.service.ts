import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EstadoPago, ModoTimbrado, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { TiendasService } from '../tiendas/tiendas.service';
import { bloqueoDeFacturacion, formaDePago, totalAFacturar } from './comprobante';
import { REGIMENES_FISCALES, RegimenFiscal, USOS_CFDI, UsoCfdi } from './catalogos-sat';
import { CatalogoSatService, FormaPagoSat } from './catalogo-sat.service';
import {
  autorDe,
  DatosFiscalesRespuesta,
  DocumentoFactura,
  FacturacionService,
  FacturaDto,
  ivaSinConfigurar,
  PedidoFacturable,
  VistaFacturaDto,
} from './facturacion.service';
import { FacturaEmitidaDto, FacturasEmitidasService } from './facturas-emitidas.service';
import { EmisorService } from './emisor.service';
import { FacturarPedidosPdvDto } from './dto/factura-pdv.dto';

/** Cuantos renglones trae cada lista: los mas recientes. */
const LIMITE = 300;

/** Un pedido de la tienda que todavia no tiene factura. */
export interface PedidoPorFacturarDto {
  id: string;
  folio: string;
  creadoEn: string;
  cliente: {
    id: string;
    nombre: string;
    telefono: string;
    /** Tiene RFC, razon social, regimen, uso y CP guardados: la factura sale llena. */
    conDatosFiscales: boolean;
  };
  total: number;
  /** Por cuanto sale su factura: lo pagado aparte del monedero, al peso. */
  aFacturar: number;
  estadoPago: EstadoPago;
  /** Null si ya se puede facturar; si no, por que todavia no. */
  bloqueo: string | null;
}

/** Lo que la hoja «Facturar» necesita para pintarse con esos pedidos. */
export interface DatosFacturaPdvDto {
  pedidos: PedidoPorFacturarDto[];
  /** La suma de lo que se factura de cada uno. */
  aFacturar: number;
  /** SIMULADO mientras el servidor no tenga llaves: la hoja avisa que no tiene validez. */
  modo: ModoTimbrado;
  regimenes: RegimenFiscal[];
  usos: UsoCfdi[];
  formasPago: FormaPagoSat[];
  /**
   * Los datos fiscales guardados del cliente, si todos los pedidos son de uno
   * y los tiene; si no, null y se capturan.
   */
  receptor: DatosFiscalesRespuesta['datos'];
  emailSugerido: string | null;
  /** El WhatsApp de ese cliente: con el se guarda lo que se capture. */
  whatsappSugerido: string | null;
  /** La forma de pago del pedido de mayor importe. */
  formaPagoSugerida: string;
}

/** A quien se le guardaron los datos fiscales con el WhatsApp capturado. */
export interface DatosGuardadosDto {
  nombre: string;
  telefono: string;
  /** No estaba registrado: se dio de alta y queda listo para comprar. */
  nuevo: boolean;
}

export type FacturaPdvDto = FacturaDto & { datosGuardadosEn: DatosGuardadosDto | null };

const SELECT_CLIENTE = {
  id: true,
  nombre: true,
  telefono: true,
  rfc: true,
  razonSocial: true,
  regimenFiscal: true,
  usoCfdi: true,
  cpFiscal: true,
} satisfies Prisma.ClienteSelect;

/** Lo que hace falta de cada renglon para saber si le falta la tasa de IVA. */
const SELECT_RENGLON_IVA = {
  nombre: true,
  cantidad: true,
  tasaIva: true,
  producto: { select: { tasaIva: true } },
} satisfies Prisma.PedidoItemSelect;

/**
 * PDV -> Facturacion: la tienda factura sus pedidos —los capturados en su
 * mostrador y los de la app que se recogieron en ella—, uno por uno o varios
 * juntos en una sola factura. El emisor no se elige: es el mismo de toda la
 * app, la cuenta de factura.com de las llaves del servidor.
 *
 * No repite nada del timbrado: los candados, el cuadre y la reserva son los de
 * `FacturacionService`, los mismos que Mis pedidos. Aqui solo se decide de que
 * tienda son y a quien se le guardan los datos fiscales.
 */
@Injectable()
export class FacturacionPdvService {
  private readonly logger = new Logger(FacturacionPdvService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly facturacion: FacturacionService,
    private readonly emisores: EmisorService,
    private readonly emitidas: FacturasEmitidasService,
    private readonly catalogoSat: CatalogoSatService,
    private readonly tiendas: TiendasService,
  ) {}

  /** Los pedidos de la tienda sin factura, del mas reciente al mas viejo. */
  async porFacturar(
    tiendaId: string,
    usuario: UsuarioAutenticado,
  ): Promise<PedidoPorFacturarDto[]> {
    await this.exigirTienda(tiendaId, usuario);
    const pedidos = await this.prisma.pedido.findMany({
      where: {
        ...FacturacionPdvService.deLaTienda(tiendaId),
        facturaId: null,
        estadoPago: { not: EstadoPago.CANCELADO },
      },
      include: {
        cliente: { select: SELECT_CLIENTE },
        items: { select: SELECT_RENGLON_IVA },
      },
      orderBy: { creadoEn: 'desc' },
      take: LIMITE,
    });
    return pedidos.map((p) => FacturacionPdvService.aPorFacturar(p, p.cliente));
  }

  /** Las facturas que cubren pedidos de la tienda. */
  async facturadas(tiendaId: string, usuario: UsuarioAutenticado): Promise<FacturaEmitidaDto[]> {
    await this.exigirTienda(tiendaId, usuario);
    return this.emitidas.deLaTienda(tiendaId, LIMITE);
  }

  /**
   * Lo que pide la hoja al abrirse. Ya aqui se dice si alguno no se puede
   * facturar (409 con su `code`): mejor que despues de capturar todo.
   */
  async datos(
    tiendaId: string,
    pedidoIds: string[],
    usuario: UsuarioAutenticado,
  ): Promise<DatosFacturaPdvDto> {
    await this.exigirTienda(tiendaId, usuario);
    const pedidos = await this.facturacion.cargarFacturables(
      pedidoIds,
      FacturacionPdvService.deLaTienda(tiendaId),
    );
    this.facturacion.exigirFacturables(pedidos);

    const clientes = await this.prisma.cliente.findMany({
      where: { id: { in: [...new Set(pedidos.map((p) => p.clienteId))] } },
      select: SELECT_CLIENTE,
    });
    const porId = new Map(clientes.map((c) => [c.id, c]));
    const unico = clientes.length === 1 ? clientes[0] : null;
    const guardados = unico ? await this.facturacion.datosFiscales(unico.id) : null;
    const mayor = pedidos.reduce((m, p) =>
      totalAFacturar(p).greaterThan(totalAFacturar(m)) ? p : m,
    );

    return {
      pedidos: pedidos.map((p) => FacturacionPdvService.aPorFacturar(p, porId.get(p.clienteId)!)),
      aFacturar: pedidos
        .reduce((s, p) => s.add(totalAFacturar(p)), new Prisma.Decimal(0))
        .toNumber(),
      modo: this.emisores.modo(),
      regimenes: REGIMENES_FISCALES,
      usos: USOS_CFDI,
      formasPago: this.catalogoSat.formasDePago(),
      receptor: guardados?.datos ?? null,
      emailSugerido: guardados?.emailSugerido ?? null,
      // Los 10 digitos: es como se teclea en el mostrador.
      whatsappSugerido: unico ? unico.telefono.replace(/\D/g, '').slice(-10) : null,
      formaPagoSugerida: formaDePago(mayor),
    };
  }

  async previsualizar(
    tiendaId: string,
    dto: FacturarPedidosPdvDto,
    usuario: UsuarioAutenticado,
  ): Promise<VistaFacturaDto> {
    FacturacionPdvService.exigirWhatsapp(dto.whatsapp);
    return this.facturacion.vista(await this.preparar(tiendaId, dto, usuario));
  }

  /**
   * Timbra. Despues, si vino un WhatsApp, guarda ahi los datos fiscales: es
   * comodidad, no parte de la factura, y si falla la factura sigue valiendo.
   */
  async facturar(
    tiendaId: string,
    dto: FacturarPedidosPdvDto,
    usuario: UsuarioAutenticado,
  ): Promise<FacturaPdvDto> {
    FacturacionPdvService.exigirWhatsapp(dto.whatsapp);
    const preparada = await this.preparar(tiendaId, dto, usuario);
    const factura = await this.facturacion.timbrar(preparada, autorDe(usuario));

    let datosGuardadosEn: DatosGuardadosDto | null = null;
    if (dto.whatsapp) {
      datosGuardadosEn = await this.guardarConWhatsapp(dto.whatsapp, dto).catch((e: unknown) => {
        this.logger.warn(`No se guardaron los datos fiscales de ${dto.whatsapp}: ${String(e)}`);
        return null;
      });
    }
    return { ...factura, datosGuardadosEn };
  }

  /** PDF o XML, solo de una factura que cubra algun pedido de la tienda. */
  async documento(
    tiendaId: string,
    facturaId: string,
    formato: 'pdf' | 'xml',
    usuario: UsuarioAutenticado,
  ): Promise<DocumentoFactura> {
    await this.exigirTienda(tiendaId, usuario);
    const deLaTienda = await this.prisma.factura.count({
      where: { id: facturaId, pedidos: { some: FacturacionPdvService.deLaTienda(tiendaId) } },
    });
    if (deLaTienda === 0) throw new NotFoundException('La factura no existe');
    return this.facturacion.documentoPorId(facturaId, formato);
  }

  // ----------------------------------------------------------------

  private async preparar(
    tiendaId: string,
    dto: FacturarPedidosPdvDto,
    usuario: UsuarioAutenticado,
  ) {
    await this.exigirTienda(tiendaId, usuario);
    const emisor = await this.emisores.actual();
    const pedidos: PedidoFacturable[] = await this.facturacion.cargarFacturables(
      dto.pedidoIds,
      FacturacionPdvService.deLaTienda(tiendaId),
    );
    return this.facturacion.preparar(pedidos, dto, emisor);
  }

  /**
   * Los datos fiscales van a quien tenga ese WhatsApp: el cliente o el
   * prospecto. Si nadie lo tiene, se da de alta como prospecto —como quien
   * llega al mostrador sin registro— con la razon social como nombre: se
   * vuelve cliente con su primera compra y su factura desde la app sale llena.
   */
  private async guardarConWhatsapp(
    whatsapp: string,
    dto: FacturarPedidosPdvDto,
  ): Promise<DatosGuardadosDto> {
    const datos = FacturacionService.columnasFiscales(dto);
    const variantes = AuthService.variantesDeTelefono(whatsapp);

    const cliente = await this.prisma.cliente.findFirst({
      where: { telefono: { in: variantes } },
      select: { id: true, nombre: true, telefono: true },
    });
    if (cliente) {
      await this.prisma.cliente.update({ where: { id: cliente.id }, data: datos });
      return { nombre: cliente.nombre, telefono: cliente.telefono, nuevo: false };
    }

    const prospecto = await this.prisma.prospecto.findFirst({
      where: { telefono: { in: variantes } },
      select: { id: true, nombre: true, telefono: true },
    });
    if (prospecto) {
      await this.prisma.prospecto.update({ where: { id: prospecto.id }, data: datos });
      return { nombre: prospecto.nombre, telefono: prospecto.telefono, nuevo: false };
    }

    const nuevo = await this.prisma.prospecto.create({
      data: {
        telefono: AuthService.normalizarTelefono(whatsapp),
        nombre: dto.razonSocial,
        ...datos,
      },
      select: { nombre: true, telefono: true },
    });
    this.logger.log(`Prospecto ${nuevo.telefono} dado de alta al facturar en el punto de venta`);
    return { ...nuevo, nuevo: true };
  }

  /**
   * La tienda tiene que ser una de las que el punto de venta le ofrece a quien
   * pregunta: el cajero con tienda asignada solo factura la suya.
   */
  private async exigirTienda(tiendaId: string, usuario: UsuarioAutenticado): Promise<void> {
    const suyas = await this.tiendas.activasPara(usuario);
    if (!suyas.some((t) => t.id === tiendaId)) {
      throw new NotFoundException('La tienda no existe o no está disponible.');
    }
  }

  /** Lo mismo que el login: diez digitos como minimo, o no hay a quien encontrar. */
  private static exigirWhatsapp(whatsapp: string | undefined): void {
    if (whatsapp && whatsapp.replace(/\D/g, '').length < 10) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'WHATSAPP_INVALIDO',
        message: ['whatsapp debe tener 10 dígitos'],
      });
    }
  }

  /** Capturados en su mostrador (por el turno) o recogidos en ella. */
  private static deLaTienda(tiendaId: string): Prisma.PedidoWhereInput {
    return { OR: [{ tiendaId }, { turno: { tiendaId } }] };
  }

  private static aPorFacturar(
    pedido: Pick<
      PedidoFacturable,
      'id' | 'folio' | 'creadoEn' | 'total' | 'pagadoConBilletera' | 'estadoPago'
    > & { items: Prisma.PedidoItemGetPayload<{ select: typeof SELECT_RENGLON_IVA }>[] },
    cliente: Prisma.ClienteGetPayload<{ select: typeof SELECT_CLIENTE }>,
  ): PedidoPorFacturarDto {
    return {
      id: pedido.id,
      folio: pedido.folio,
      creadoEn: pedido.creadoEn.toISOString(),
      cliente: {
        id: cliente.id,
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        conDatosFiscales: Boolean(
          cliente.rfc &&
          cliente.razonSocial &&
          cliente.regimenFiscal &&
          cliente.usoCfdi &&
          cliente.cpFiscal,
        ),
      },
      total: pedido.total.toNumber(),
      aFacturar: totalAFacturar(pedido).toNumber(),
      estadoPago: pedido.estadoPago,
      // Primero lo del pago; si eso esta bien, que falte la tasa de algun producto.
      bloqueo: bloqueoDeFacturacion(pedido)?.mensaje ?? ivaSinConfigurar(pedido.items),
    };
  }
}
