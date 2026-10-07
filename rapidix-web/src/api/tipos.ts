/**
 * Contratos de la API de Rapidix (SPEC 01 + los tres añadidos del SPEC 02).
 *
 * Se escriben a mano contra los DTO del backend. Si un endpoint cambia, esto
 * cambia con él: es el único sitio del frontend que conoce la forma del cable.
 */

// ------------------------------------------------------------------
// Identidad y permisos
// ------------------------------------------------------------------

/** Los cinco modos de acceso del Word 2.4. */
export type RolToken = 'ADMINISTRADOR' | 'RUTA' | 'OPERACIONES' | 'FINANZAS' | 'CLIENTE'

/** Las diez secciones de `PERMISOS_POR_ROL`. */
export type Seccion =
  | 'productos'
  | 'recetas'
  | 'configuracion'
  | 'operaciones'
  | 'rutas'
  | 'finanzas'
  | 'mis-pedidos'
  | 'mis-cupones'
  | 'clientes'
  | 'pdv'

/** Lo que devuelve `GET /auth/yo`: el payload del token. */
export interface UsuarioAutenticado {
  sub: string
  rol: RolToken
  nombre: string
}

/** Respuesta de los tres endpoints de login. */
export interface RespuestaToken {
  accessToken: string
  rol: RolToken
  nombre: string
}

export interface RespuestaVerificarCodigo extends RespuestaToken {
  esNuevo: boolean
  cuponesNuevos: number
}

/** Modos de acceso que ofrece la API (`GET /auth/modo`). */
export interface ModoAcceso {
  /**
   * La API corre con `AUTH_DEMO_LOGIN`: se entra tocando un rol, sin
   * credenciales. Simula a n8n mientras esa pieza no existe.
   */
  demoLogin: boolean
}

/** Respuesta del paso 1 del login de cliente. */
export interface RespuestaSolicitarCodigo {
  enviado: true
  expiraEnMinutos: number
  /**
   * El código ya generado, cuando la API corre con `AUTH_OTP_BYPASS`. En ese
   * caso el login lo verifica solo y nunca enseña la pantalla del código.
   * `null` en el flujo normal, donde el código llega por WhatsApp.
   */
  codigoAutomatico: string | null
}

/** Fila de `GET /admin/menu`. */
export interface ItemMenu {
  seccion: Seccion
  icono: string
  titulo: string
  descripcion: string
}

// ------------------------------------------------------------------
// Destacados (Word 4.6)
// ------------------------------------------------------------------

export interface Noticia {
  id: string
  badge: string
  titulo: string
  desc: string
  publicadoEn: string
}

export interface Aviso {
  id: string
  icon: string
  titulo: string
  desc: string
  publicadoEn: string
}

export interface Destacados {
  noticias: Noticia[]
  avisos: Aviso[]
  /** Insignia numérica del icono de la barra inferior. */
  noLeidos: number
}

// ------------------------------------------------------------------
// Recetario
// ------------------------------------------------------------------

/** Respuesta de `GET /recetario/pausada`. `null` si no hay ninguna. */
export interface RecetaPausada {
  recetaId: string
  nombre: string
  emoji: string | null
  imagenUrl: string | null
  pausadaEn: string
}

// ------------------------------------------------------------------
// Tienda y catálogo
// ------------------------------------------------------------------

/**
 * Papel del producto dentro de su familia. Desempata el orden de la Tienda
 * cuando el cliente no tiene historial: Destino primero, Conveniencia al final.
 */
export type RolProducto = 'DESTINO' | 'RUTINA' | 'ESTACIONAL' | 'CONVENIENCIA'

export interface Producto {
  id: string
  nombre: string
  categoria: string
  unidad: string
  precioCosto: number
  precioVenta: number
  imagenUrl: string | null
  agotado: boolean
  rol: RolProducto
  /** Existencia física en bodega. Solo se mueve desde Movimientos. */
  inventario: number
  /** Lo liberado para venta: el saldo del que descuenta un pedido. */
  aptInventario: number
  /**
   * Listas de precio por volumen, sin la del precio de venta (HU-08). Vacío =
   * sin precio escalonado. De aquí salen los botones «Lleva más, paga menos».
   */
  escalones: Escalon[]
  /** Si suma a la base del cashback (HU-12). */
  aplicaCashback: boolean
}

/** Una lista de precio por volumen: desde `piso` piezas, cada una a `precio`. */
export interface Escalon {
  piso: number
  precio: number
}

export interface CategoriaConProductos {
  categoria: string
  productos: Producto[]
}

/** Una familia del catálogo, tal como la administra el negocio. */
export interface CategoriaAdmin {
  id: string
  nombre: string
  totalProductos: number
  /** Orden en la Tienda: 1 va primero, 99 es «sin priorizar». */
  prioridad: number
}

/** Producto del catálogo ordenado, con lo que este cliente ha hecho con él. */
export interface ProductoRecomendado extends Producto {
  /** Venía en su último pedido: su fila del carrusel arranca centrada en él. */
  ultimoComprado: boolean
  /** En cuántos de sus pedidos ha aparecido. 0 para un visitante. */
  vecesComprado: number
}

/** Una fila de la Tienda. */
export interface FamiliaRecomendada {
  categoria: string
  prioridad: number
  /** La familia estaba en su último pedido: sube al bloque de arriba. */
  enUltimoPedido: boolean
  productos: ProductoRecomendado[]
}

/** Respuesta de `GET /productos/recomendados`. El token es opcional. */
export interface CatalogoRecomendado {
  familias: FamiliaRecomendada[]
  /** El orden salió del historial de quien pregunta, no del catálogo plano. */
  personalizado: boolean
  /**
   * Si un pedido descuenta existencias. La Tienda solo topa la cantidad al
   * saldo cuando está encendido: apagado, todos los productos están en cero.
   */
  controlInventario: boolean
}

// ------------------------------------------------------------------
// Carrito y pedido
// ------------------------------------------------------------------

/** Lo que el carrito manda a la API: nunca precios, solo id y cantidad. */
export interface LineaCarrito {
  productoId: string
  cantidad: number
}

/**
 * Una línea del carrito tal como la valoró la API, con su precio escalonado
 * (HU-08 y HU-10). La interfaz no conoce las listas de precio: solo pinta.
 */
export interface LineaCalculada {
  productoId: string
  /** Precio por pieza con la cantidad de la línea. */
  precioUnitario: number
  cantidad: number
  importe: number
  /** El producto se agotó después de meterlo al carrito. */
  agotado: boolean
  /** Precio de la lista anterior, tachado. `null` en la primera lista. */
  precioLista: number | null
  /** «Ahorras», frente al precio de venta. */
  ahorro: number
  /** «Te faltan N». `null` cuando no toca ofrecerlo. */
  upsell: { faltan: number; precioSiguiente: number; ahorro: number } | null
}

export interface ItemPrevisualizado extends LineaCalculada {
  nombre: string
  unidad: string
}

/** Lo que le falta al carrito para ganar algo más. */
export interface MetasCarrito {
  /** Lo que falta para el envío gratis. `null` si ya lo tiene. */
  faltaEnvioGratis: number | null
  /** Lo que falta para activar el cashback; solo desde el 80 % del mínimo. */
  faltaCashback: number | null
  /** Hay productos, pero ninguno participa en el cashback. */
  sinCashback: boolean
}

/** Cómo se cobra lo que queda tras el cupón y la billetera. */
export type MetodoPago = 'EFECTIVO' | 'TRANSFERENCIA'

/** Recoger en tienda no paga envío. */
export type MetodoEntrega = 'DOMICILIO' | 'TIENDA'

/** Lo que decidió Finanzas sobre el dinero. Nace en `PAGO_PENDIENTE`. */
export type EstadoPago =
  | 'PAGO_PENDIENTE'
  | 'RETENER'
  | 'CREDITO'
  | 'REEMBOLSADO'
  | 'PAGADO'
  | 'CANCELADO'

/** Dónde está físicamente la mercancía. Cancelar vive en el eje de pago. */
export type EstadoPedido =
  | 'CONFIRMADO'
  | 'EN_PREPARACION'
  | 'PREPARADO'
  | 'LISTO_PARA_ENTREGA'
  | 'RECOLECTADO'
  | 'EN_RUTA'
  | 'ENTREGADO'

/** Por qué el pago elegido no deja confirmar. */
export interface ErrorPago {
  codigo:
    | 'METODO_REQUERIDO'
    | 'PAGO_CON_REQUERIDO'
    | 'PAGO_INSUFICIENTE'
    | 'BILLETERA_INSUFICIENTE'
    | 'BILLETERA_EXCEDE_TOTAL'
  mensaje: string
}

/** Respuesta de `POST /carrito/previsualizar`. */
export interface PrevisualizacionCarrito {
  items: ItemPrevisualizado[]
  subtotal: number
  envio: number
  recargoFuera: number
  descuento: number
  total: number
  /** Saldo de billetera aplicado. */
  billetera: number
  /** Lo que se cobra en efectivo o por transferencia. */
  aPagar: number
  /** Cashback base, sin el ×2 de la billetera (HU-12). */
  cashbackEstimado: number
  /** Lo que se acreditaría en la billetera: la base por el multiplicador. */
  cashbackBilletera: number
  cupon: { codigo: string; descripcion: string } | null
  pago: {
    /** 0 si no tiene billetera: el bloque no se pinta. */
    saldoBilletera: number
    metodo: MetodoPago | null
    pagoCon: number | null
    cambio: number | null
    errorPago: ErrorPago | null
    errorBilletera: ErrorPago | null
  }
  metodoEntrega: MetodoEntrega
  dentroDeHorario: boolean
  /** false si el carrito no se puede confirmar tal y como está. No mira el pago. */
  puedePedir: boolean
  metas: MetasCarrito
  avisos: string[]
}

/**
 * Respuesta de `POST /carrito/subtotal`.
 *
 * Lo que suman los productos, sin envío ni recargo ni cupón, con lo que le
 * falta al carrito y el cashback que dejaría. Es lo que pinta la barra de
 * compra de la Tienda, y lo calcula la API también para el visitante sin
 * sesión: aquí no se suman precios a mano.
 */
export interface SubtotalCarrito {
  /** Con nombre y unidad: el widget «Mi carrito» los pinta también al visitante. */
  items: ItemPrevisualizado[]
  subtotal: number
  /** Con el % del nivel de entrada: el visitante todavía no tiene nivel. */
  cashbackEstimado: number
  /** `null` con el carrito vacío. */
  metas: MetasCarrito | null
  avisos: string[]
}

/**
 * Dirección de entrega de UN pedido (épica «Dirección de entrega»).
 *
 * No es la del perfil: parte de ella, pero lo que se edita aquí vive en el
 * borrador del pedido y viaja como copia en `POST /pedidos`. Los textos nunca
 * son `null` para que el formulario los enlace sin conversiones.
 */
export interface DireccionEntrega {
  quienRecibe: string
  telefono: string
  calle: string
  colonia: string
  cp: string
  ciudad: string
  estado: string
  referencias: string
  lat: number | null
  lng: number | null
}

/** Borrador del checkout que se respalda junto al carrito. */
export interface BorradorEntrega {
  metodoEntrega: MetodoEntrega | null
  /** `null`: no la ha tocado y el checkout parte del perfil. */
  direccion: DireccionEntrega | null
}

/** Respuesta de `GET /perfil/carrito` y `PUT /perfil/carrito`. */
export interface CarritoGuardado {
  items: LineaCarrito[]
  actualizadoEn: string | null
  entrega: BorradorEntrega | null
}

/** Respuesta de `GET /pedidos/ultimo`. `null` si todavía no ha comprado. */
export interface UltimoPedido {
  folio: string
  creadoEn: string
  /** Snapshot de la dirección a la que se entregó aquel pedido. */
  direccion: Record<string, unknown> | null
  items: {
    productoId: string
    nombre: string
    unidad: string
    cantidad: number
    /** Lo que cuesta hoy, no lo que costó entonces. */
    precioUnitario: number
    importe: number
    precioAnterior: number
    disponible: boolean
  }[]
  subtotal: number
  avisos: string[]
}

/** Respuesta de `POST /carrito/validar-cupon`. Un rechazo también es 200. */
export type ResultadoCupon =
  | {
      valido: true
      cuponId: string
      codigo: string
      titulo: string
      subtotal: number
      descuento: number
    }
  | { valido: false; motivo: string; mensaje: string; subtotal: number }

export interface ItemPedido {
  productoId: string
  nombre: string
  categoria: string
  unidad: string
  precioUnitario: number
  cantidad: number
  importe: number
}

/** Un abono a un pedido a crédito. */
export interface AbonoPedido {
  id: string
  monto: number
  metodo: MetodoPago
  /** Lo recibió el repartidor al entregar. */
  enPuerta: boolean
  creadoEn: string
}

export interface Pedido {
  id: string
  folio: string
  clienteId: string
  clienteNombre?: string
  subtotal: number
  envio: number
  recargoFuera: number
  descuento: number
  total: number
  cashbackGenerado: number
  /** `false` hasta que el pago queda `PAGADO`: todavía no está en la billetera. */
  cashbackAcreditado: boolean
  estado: EstadoPedido
  pago: {
    metodo: MetodoPago
    estado: EstadoPago
    billetera: number
    aPagar: number
    pagoCon: number | null
    cambio: number | null
    /** Concepto de la transferencia: el folio. */
    referencia: string
    /** Cuenta por cobrar con saldo: se cobra desde CXC, no marcándolo Pagado. */
    enCxc: boolean
    /** Lo que ya abonó: en la puerta al entregarse a crédito, o después desde CXC. */
    abonos: AbonoPedido[]
    /** La suma de los abonos. */
    abonado: number
    /** Lo que falta por pagar. Cero si ya está pagado, reembolsado o cancelado. */
    saldo: number
  }
  metodoEntrega: MetodoEntrega
  /** Copia de la dirección del pedido; `null` si se recoge en tienda. */
  direccion: Record<string, unknown> | null
  cupon: { code: string; titulo: string } | null
  items: ItemPedido[]
  creadoEn: string
}

/** Por qué no se puede dar el siguiente paso. El `codigo` es el mismo del 409. */
export interface BloqueoPaso {
  codigo:
    | 'TRANSICION_INVALIDA'
    | 'SOLO_A_DOMICILIO'
    | 'SOLO_EN_TIENDA'
    | 'PEDIDO_CANCELADO'
    | 'PAGO_RETENIDO'
    | 'PAGO_NO_LIBERADO'
    /** Transferencia sin Pagado ni Crédito: no se entrega. El efectivo se cobra en la puerta. */
    | 'PAGO_NO_CUBIERTO'
  mensaje: string
}

/** Lo calcula la API: la pantalla solo enciende el botón o enseña el bloqueo. */
export interface PasoPendiente {
  /** `null` cuando ya no le queda ningún paso. */
  siguiente: EstadoPedido | null
  /** A quién le toca darlo. */
  seccion: 'operaciones' | 'rutas' | null
  bloqueo: BloqueoPaso | null
}

/** Pedido de una pantalla de trabajo (Operaciones, Rutas…). */
export interface PedidoEnPantalla extends Pedido {
  paso: PasoPendiente
  /**
   * Si el dinero ya permite entregarlo (Pagado, Crédito, o efectivo que se
   * cobra en la puerta). Lo calcula la API con la misma regla del candado.
   */
  pagoCubierto: boolean
}

export type FiltroOperaciones = 'activos' | 'en-ruta' | 'entregados' | 'cancelados'

/** Respuesta de `GET /admin/operaciones/pedidos`. */
export interface ListadoOperaciones {
  pedidos: PedidoEnPantalla[]
  conteos: Record<FiltroOperaciones, number>
}

/** Por qué Finanzas no puede dejar el pedido en ese estatus. */
export interface BloqueoPago {
  codigo: 'PAGO_TERMINAL' | 'MERCANCIA_FUERA' | 'PEDIDO_EN_CXC' | 'MISMO_ESTADO'
  mensaje: string
}

/** Uno de los siete botones de Finanzas, con su candado ya resuelto por la API. */
export interface BotonPago {
  estado: EstadoPago
  titulo: string
  /** El que tiene ahora: se pinta apagado, pero no es un error. */
  actual: boolean
  bloqueo: BloqueoPago | null
}

/** Pedido de la pantalla de Finanzas. */
export interface PedidoEnFinanzas extends Pedido {
  botones: BotonPago[]
}

export type FiltroFinanzas = 'por-decidir' | 'credito' | 'pagados' | 'cancelados' | 'todos'

/** Respuesta de `GET /admin/finanzas/pedidos`. */
export interface ListadoFinanzas {
  pedidos: PedidoEnFinanzas[]
  conteos: Record<FiltroFinanzas, number>
}

// ------------------------------------------------------------------
// Rutas: la jornada del repartidor, el camión y el corte
// ------------------------------------------------------------------

/** Por qué el cliente no se quedó con la mercancía. Catálogo cerrado de la API. */
export type MotivoDevolucion =
  | 'NO_LO_QUISO'
  | 'DANADO'
  | 'SIN_QUIEN_RECIBA'
  | 'PRECIO_EQUIVOCADO'

/** La jornada del repartidor. `null` hasta que crea su primera entrega del día. */
export interface Jornada {
  id: string
  iniciadaEn: string
  /** Solo en jornadas finalizadas enteras, de antes de finalizar por entrega. */
  finalizadaEn: string | null
  /** Piezas que siguen arriba del camión. Cero no significa que ya pueda liquidar. */
  piezasEnCamion: number
}

/**
 * Un renglón del camión. No es el renglón del pedido: el pedido dice lo que se
 * compró y esto lo que subió, con el id que hay que mandar al entregar.
 */
export interface RenglonDeCarga {
  pedidoItemId: string
  productoId: string
  nombre: string
  unidad: string
  cantidadCargada: number
  cantidadEntregada: number
  cantidadDevuelta: number
  precioUnitario: number
  /** Re-cotizado al volumen que aceptó el cliente; `null` si manda el de arriba. */
  precioEntregado: number | null
  motivoDevolucion: MotivoDevolucion | null
  /** `false` cuando el corte ya lo descargó: es un intento anterior. */
  enCamion: boolean
}

/** La evidencia de la entrega que cerró el pedido. La foto se pide aparte, por su id. */
export interface EvidenciaEntrega {
  fotoId: string | null
  lat: number | null
  lng: number | null
  creadoEn: string
  /** Quién lo entregó. */
  repartidorNombre: string
}

/** El pedido con lo que de él va —o fue— en el camión. */
export interface PedidoEnRuta extends PedidoEnPantalla {
  carga: RenglonDeCarga[]
  /** `null` mientras no se haya entregado. */
  evidencia: EvidenciaEntrega | null
  /** La entrega en la que va o fue; `null` en bodega. */
  entrega: { id: string; numero: number; nombre: string | null } | null
}

/** Una entrega (viaje) del repartidor, con lo que lleva contado por la API. */
export interface EntregaRuta {
  id: string
  /** Folio de reparto (`REP000123`): lo que la identifica fuera de su jornada. */
  folio: string
  numero: number
  nombre: string | null
  creadoEn: string
  pedidos: number
  /** Arriba del camión, sin salir todavía. */
  recolectados: number
  enRuta: number
  entregados: number
  /** `null` hasta pulsar «Iniciar entrega» dentro de ella: crearla no la arranca. */
  iniciadaEn: string | null
  /** «Finalizar entrega»: ya no sale nada más en ella hasta reanudarla. */
  finalizadaEn: string | null
  /** Ya tiene su corte: se consulta, no se mueve. */
  cortada: boolean
  /**
   * Finanzas rechazó su devolución y la liquidación se deshizo: el motivo y
   * cuándo. `null` si nunca pasó o si ya se volvió a liquidar.
   */
  rechazoDevolucion: { motivo: string; en: string } | null
}

/** Respuesta de `GET /admin/rutas/entregas/:id`. */
export interface DetalleEntregaRuta {
  jornada: Jornada | null
  entrega: EntregaRuta
  /** `false` si ya se cortó (ella o su jornada): se consulta, no se carga. */
  abierta: boolean
  pedidos: PedidoEnRuta[]
  /** Lo que espera en bodega, para subirlo a esta entrega. */
  disponibles: PedidoEnRuta[]
}

export type FiltroRutas = 'disponibles' | 'en-camion' | 'entregados'

/** Respuesta de `GET /admin/rutas`: la jornada y los pedidos, de un viaje. */
export interface TableroRutas {
  jornada: Jornada | null
  /** Las entregas de la jornada viva. */
  entregas: EntregaRuta[]
  pedidos: PedidoEnRuta[]
  conteos: Record<FiltroRutas, number>
}

/** Cómo acabó el intento de entrega, según lo contó la API. */
export interface ResumenEntrega {
  piezasEntregadas: number
  /** Lo que el cliente no aceptó. Sigue en el camión hasta el corte. */
  piezasDevueltas: number
  /** Lo que se cobra por lo que quedó en casa del cliente. **No es el total.** */
  importeEntregado: number
  parcial: boolean
}

/**
 * Respuesta de `POST pedidos/:id/entregar/previsualizar`: la cuenta de la hoja
 * mientras se cuenta. Sale de las mismas funciones que el corte.
 */
export interface PrevisualizacionEntrega {
  renglones: {
    pedidoItemId: string
    cantidadEntregada: number
    /** El unitario que toca por lo aceptado: el del pedido o el re-cotizado. */
    precio: number
    importe: number
  }[]
  productos: number
  envio: number
  recargoFuera: number
  descuento: number
  billetera: number
  cobraEnEfectivo: boolean
  /** El efectivo que se cobra en la puerta. */
  aCobrar: number
  /** `null` mientras el pago recibido no cubra el cobro. */
  cambio: number | null
  cubre: boolean
  /**
   * Lo que el pedido a crédito queda debiendo: el tope del abono opcional en
   * la puerta. `null` si no es a crédito.
   */
  saldoCredito: number | null
}

/** Respuesta de `POST pedidos/:id/entregar` y de `no-entregar`. */
export interface ResultadoEntrega {
  pedido: PedidoEnRuta
  entrega: ResumenEntrega
}

/** Un pedido dentro del corte: lo que trae de él y lo que regresa. */
export interface PedidoDelCorte {
  id: string
  folio: string
  clienteNombre: string
  estado: EstadoPedido
  estadoPago: EstadoPago
  metodoPago: MetodoPago
  /** Regresa a bodega: cancelado, o se quedó en el camión. */
  devolucion: boolean
  /** Nació de «Generar pedido x faltante» en esta liquidación. */
  porFaltante: boolean
  /** Efectivo que trae por este pedido. Cero en transferencia o crédito. */
  efectivo: number
  devueltas: number
  /** Lo aceptado en una entrega (sin los renglones en cero); lo cargado en una devolución. */
  productos: { nombre: string; unidad: string; cantidad: number }[]
}

/** Lo que baja del camión por producto. `cargado − entregado = devolucion`, siempre. */
export interface ConteoDeProducto {
  productoId: string
  nombre: string
  unidad: string
  cargado: number
  entregado: number
  devolucion: number
}

/** Respuesta de `GET /admin/rutas/entregas/:id/indicadores`: el encabezado de esa entrega. */
export interface IndicadoresRuta {
  pedidos: number
  entregados: number
  devoluciones: number
  /** Sale de lo entregado, no del total de los pedidos. */
  efectivoEsperado: number
}

/** Una entrega del historial del repartidor, con su corte si ya lo tiene. */
export interface EntregaEnHistorial {
  id: string
  /** Folio de reparto (`REP000123`). */
  folio: string
  numero: number
  nombre: string | null
  creadoEn: string
  iniciadaEn: string | null
  finalizadaEn: string | null
  /** Los que salieron en ella, incluidos los que regresaron a bodega. */
  pedidos: number
  corte: Corte | null
}

/** Cómo acabó un pedido en una entrega concreta, que no es su estado de hoy. */
export type ResultadoDelIntento =
  | 'ENTREGADO'
  | 'PARCIAL'
  | 'EN_CAMION'
  | 'EN_RUTA'
  | 'DEVUELTO'
  | 'CANCELADO'

export interface PedidoEnHistorial {
  id: string
  folio: string
  clienteNombre: string
  total: number
  metodoPago: MetodoPago
  estadoPago: EstadoPago
  /** Nació de «Generar pedido x faltante»: no subió al camión. */
  porFaltante: boolean
  resultado: ResultadoDelIntento
  renglones: {
    nombre: string
    unidad: string
    cantidad: number
    /** `null` mientras el pedido no cierra: no es cero. */
    recibido: number | null
    motivo: MotivoDevolucion | null
  }[]
}

/** Respuesta de `GET /admin/rutas/entregas/:id/historial`. */
export interface DetalleHistorial {
  pedidos: PedidoEnHistorial[]
  conteo: ConteoDeProducto[]
}

/** Respuesta de `GET /admin/rutas/entregas/:id/corte`: lo que el sistema dice que trae. */
export interface ResumenCorte {
  montoCalculado: number
  pedidos: PedidoDelCorte[]
  piezasQueRegresan: number
  /** Pedidos que no se entregaron y vuelven a bodega para salir otro día. */
  pedidosQueRegresan: number
  /**
   * Es la última entrega de la jornada que faltaba por liquidar. La jornada no
   * se cierra aquí, sino cuando Finanzas acepta su devolución.
   */
  cierraJornada: boolean
  /** Lo que baja del camión por producto: cargado, entregado y devolución. */
  conteo: ConteoDeProducto[]
  /**
   * Por qué Finanzas rechazó la devolución la última vez que se liquidó esta
   * entrega, o `null`. Es lo que el repartidor tiene que corregir.
   */
  rechazoDevolucion: string | null
}

export type EstadoCorte = 'LIQUIDADO' | 'ACEPTADO' | 'CERRADO'

export interface Corte {
  id: string
  repartidorId: string
  repartidorNombre: string
  cerradoEn: string
  montoCalculado: number
  montoDeclarado: number
  montoRecibido: number | null
  /** Declarado menos calculado: negativo es faltante. */
  diferencia: number
  /**
   * El adeudo del repartidor: lo calculado menos el dinero aceptado y los
   * abonos aceptados. Cero mientras Finanzas no acepte el dinero.
   */
  saldoPendiente: number
  /** Cuándo se aceptó el dinero de la liquidación, y quién. */
  recibidoEn: string | null
  recibidoPorNombre: string | null
  /** «Aceptar devolución»: cuándo bajó la mercancía del camión, y quién la vio. */
  devolucionAceptadaEn: string | null
  devolucionAceptadaPorNombre: string | null
  /** «Entrega aceptada». */
  entregaAceptadaEn: string | null
  entregaAceptadaPorNombre: string | null
  /**
   * Lo que «Aceptar dinero» aceptaría ahora: lo declarado si el dinero de la
   * liquidación sigue sin aceptar, el abono pendiente si lo hay, o `null` si no
   * hay dinero esperando.
   */
  dineroPorAceptar: number | null
  estado: EstadoCorte
  notas: string | null
  /**
   * La entrega que liquida, con su folio de reparto. `null` en los cortes de
   * jornada entera de antes, que no tienen entrega propia ni por tanto folio.
   */
  entrega: { id: string; folio: string; numero: number; nombre: string | null } | null
  abonos: AbonoDelCorte[]
  pedidos: number
}

/** Un dinero que el repartidor entrega después de la liquidación, contra su adeudo. */
export interface AbonoDelCorte {
  id: string
  monto: number
  registradoPorNombre: string
  nota: string | null
  creadoEn: string
  /** `null` mientras Finanzas no lo acepte: aún no cuenta contra el adeudo. */
  aceptadoEn: string | null
}

/** Las pestañas de Cortes de ruta en Finanzas: una por estatus. */
export type FiltroCortes = 'por-aceptar' | 'con-adeudo' | 'cerrados'

/** Respuesta de `GET /admin/finanzas/cortes`. */
export interface ListadoCortes {
  cortes: Corte[]
  conteos: Record<FiltroCortes, number>
}

/** Respuesta de `GET /admin/finanzas/cortes/:id`: el corte con lo que salió y lo que baja. */
export interface DetalleCorte extends DetalleHistorial {
  corte: Corte
}

// ------------------------------------------------------------------
// Ingresos y cuentas por cobrar (SPEC 04)
// ------------------------------------------------------------------

/** De dónde viene un ingreso: el dinero de un reparto o el pago de una cuenta por cobrar. */
export type ConceptoIngreso = 'ENTREGA' | 'CXC'

/** Un renglón del libro de lo que Finanzas aceptó. */
export interface Ingreso {
  id: string
  creadoEn: string
  concepto: ConceptoIngreso
  /** Folio de reparto (ENTREGA) o de pedido (CXC). */
  referencia: string
  monto: number
  metodo: MetodoPago
  nota: string | null
  /** Quién lo aceptó. */
  registradoPorNombre: string
}

/** Respuesta de `GET /admin/finanzas/ingresos`. */
export interface ListadoIngresos {
  /** El rango que de verdad se consultó (`AAAA-MM-DD`): sin fechas, hoy. */
  desde: string
  hasta: string
  ingresos: Ingreso[]
  /** La suma de **todo** el rango, no solo de los renglones que viajan. */
  total: number
  /** Cuántos hay en el rango. Si pasa de los que viajan, hay que acotar. */
  cuantos: number
}

/** Una cuenta por cobrar: un pedido entregado a crédito, con sus pagos y su saldo. */
export interface PedidoCxc {
  id: string
  folio: string
  clienteNombre: string
  clienteTelefono: string
  /** Desde cuándo es cuenta por cobrar. */
  cxcDesde: string
  /** El reparto en que se entregó. `null` si se recogió en tienda. */
  repartoFolio: string | null
  estadoPago: EstadoPago
  total: number
  pagadoConBilletera: number
  pagado: number
  /** Lo que falta. Ya calculado: la pantalla no hace cuentas. */
  saldo: number
  productos: {
    nombre: string
    unidad: string
    cantidad: number
    precioUnitario: number
    importe: number
  }[]
  pagos: {
    id: string
    monto: number
    metodo: MetodoPago
    nota: string | null
    registradoPorNombre: string
    creadoEn: string
  }[]
}

export type FiltroCxc = 'con-saldo' | 'cobradas'

/** Respuesta de `GET /admin/finanzas/cxc`. */
export interface ListadoCxc {
  pedidos: PedidoCxc[]
  conteos: Record<FiltroCxc, number>
  /** Lo que se debe entre **todas** las cuentas con saldo, no solo las que viajan. */
  porCobrar: number
}

/** Un renglón de `GET /admin/pedidos/:id/bitacora`. */
export interface RenglonBitacora {
  id: string
  eje: 'PEDIDO' | 'PAGO'
  /** `null` en el renglón con el que nace el pedido. */
  estadoAnterior: string | null
  estadoNuevo: string
  nota: string | null
  actor: 'CLIENTE' | 'PERSONAL' | 'SISTEMA'
  actorNombre: string
  creadoEn: string
}

// ------------------------------------------------------------------
// Recetario (Word 4.4 y 6.4)
// ------------------------------------------------------------------

/** Pestañas que atiende `GET /recetas`. "historial" tiene endpoint propio. */
export type PestanaReceta = 'recetario' | 'mias' | 'comunidad'

export type CategoriaReceta = 'desayuno' | 'comida' | 'cena'

export interface RecetaResumen {
  id: string
  nombre: string
  tiempo: string
  porciones: number
  imagenUrl: string | null
  emoji: string | null
  categorias: string[]
  autorNombre: string
  origin: string
  compartir: boolean
  esPropia: boolean
  guardada: boolean
  calificacionPromedio: number | null
  totalCalificaciones: number
}

export interface RecetaDetalle extends RecetaResumen {
  youtube: string | null
  ingredientes: { nombre: string; cantidad: string }[]
  pasos: string[]
  /** Calificación que dio este cliente, si ya calificó. */
  miCalificacion: number | null
  /** Si ya marcó "¡Listo a comer!" y por tanto puede calificar. */
  puedeCalificar: boolean
}

export interface EntradaHistorial {
  fecha: string
  categoria: string
  recetaId: string
  receta: string
  emoji: string | null
}

/** Cuerpo de `POST /recetas` y `PATCH /recetas/:id`. */
export interface GuardarReceta {
  nombre: string
  tiempo?: string
  porciones?: number
  imagenUrl?: string
  emoji?: string
  youtube?: string
  categorias: CategoriaReceta[]
  ingredientes?: { nombre: string; cantidad?: string }[]
  pasos?: string[]
  compartir?: boolean
}

// ------------------------------------------------------------------
// Cupones del cliente (Word 4.5)
// ------------------------------------------------------------------

/** `GET /cupones` devuelve solo los ACTIVE que no han vencido. */
export interface MiCupon {
  id: string
  code: string
  title: string
  /** Texto largo del cupón. La tarjeta lo pinta bajo el título. */
  description: string | null
  customerMessage: string | null
  discountType: string
  discountValue: number
  minimumOrderAmount: number
  maximumOrderAmount: number | null
  expiresAt: string
  /** `LIFECYCLE` o `CAMPAIGN`. El Home destaca el de ciclo de vida. */
  sourceKind: string
  sourceCode: string
}

// ------------------------------------------------------------------
// Perfil, dirección y cashback (Word 4.7)
// ------------------------------------------------------------------

export interface Direccion {
  calle: string | null
  colonia: string | null
  cp: string | null
  ciudad: string | null
  estado: string | null
  referencias: string | null
  lat: number | null
  lng: number | null
}

export interface Perfil {
  id: string
  nombre: string
  email: string | null
  /** Solo lectura: es la identidad de login. */
  telefono: string
  fechaNacimiento: string | null
  quienRecibe: string | null
  /** Sucursal del cliente. Solo se usa para segmentar campañas. */
  sucursal: string | null
  direccion: Direccion
  notificaciones: boolean
  pedidos: number
  totalGastado: number
  primerPedido: string | null
  ultimoPedido: string | null
  creado: string
}

/** Cuerpo de `PATCH /perfil`. `telefono` no se puede mandar: da 400. */
export interface ActualizarPerfil {
  nombre?: string
  email?: string
  fechaNacimiento?: string
  quienRecibe?: string
  sucursal?: string
  calle?: string
  colonia?: string
  cp?: string
  ciudad?: string
  estado?: string
  referencias?: string
  lat?: number
  lng?: number
  notificaciones?: boolean
}

export interface EstadoCashback {
  saldo: number
  nivelActual: string | null
  proximoNivel: string | null
  progresoPct: number
  montoFaltante: number
  totalGastado: number
  /** % de cashback que gana hoy: el de su nivel más su bono. */
  porcentaje: number
}

export interface MovimientoCashback {
  id: string
  monto: number
  concepto: string
  pedidoFolio: string | null
  creadoEn: string
}

// ------------------------------------------------------------------
// Configuración del negocio (Word 6.8, HU-A04 a HU-A07)
// ------------------------------------------------------------------

export type ClaveDia = 'lun' | 'mar' | 'mie' | 'jue' | 'vie' | 'sab' | 'dom'

export interface Horario {
  diasServicio: Record<string, boolean>
  abre: string
  cierra: string
  atenderFuera: boolean
  incrementoFuera: number
  whatsappAyuda: string | null
}

export interface Parametros {
  costoEnvio: number
  montoEnvioGratis: number
  /** Cuántas veces vale el cashback al ir a la billetera (×2). El % es del nivel. */
  multiplicadorCashback: number
  montoMinimoCashback: number
  /** Si un pedido descuenta existencias de la bodega. */
  controlInventario: boolean
}

export interface Bancarios {
  banco: string | null
  beneficiario: string | null
  numeroCuenta: string | null
  numeroTarjeta: string | null
  /** 18 dígitos (SPEI). */
  clabe: string | null
}

/**
 * Nivel de fidelidad (HU-17). No existen en el Word ni en el prototipo: se
 * configuran aquí. Los Decimal llegan como texto, de ahí el `| string`.
 */
export interface NivelFidelidad {
  id: string
  nombre: string
  umbralGasto: number | string
  orden: number
  /** Cashback del nivel en puntos porcentuales: 1.5 = 1.5 %. */
  porcentaje: number | string
}

// ------------------------------------------------------------------
// Motor de cupones — administración (Word 4.9)
// ------------------------------------------------------------------

export type TipoDescuento = 'PERCENTAGE' | 'FIXED'

/** Los cinco tipos fijos. El `code` no es editable, solo sus parámetros. */
export interface TipoCicloVida {
  code: string
  name: string
  title: string
  description: string
  customerMessage: string
  discountType: TipoDescuento
  discountValue: number
  minimumOrderAmount: number
  maximumOrderAmount: number | null
  validityDays: number
  usageLimitPerCustomer: number
  /** Solo INACTIVITY. */
  inactivityDays: number | null
  /** Solo BIRTHDAY. */
  birthdayWindowDays: number | null
  isActive: boolean
  generados: number
  utilizados: number
  porcentajeUtilizacion: number
}

// ---- Constructor de segmentos ----

export const ATRIBUTOS_SEGMENTO = [
  'pedidos',
  'totalGastado',
  'diasSinComprar',
  'diasComoCliente',
  'cliente',
  'sucursal',
  'colonia',
  'ciudad',
  'estado',
  'mesCumpleanos',
] as const
export type AtributoSegmento = (typeof ATRIBUTOS_SEGMENTO)[number]

export const OPERADORES_SEGMENTO = ['>', '>=', '<', '<=', '=', 'contiene'] as const
export type OperadorSegmento = (typeof OPERADORES_SEGMENTO)[number]

/** `contiene` solo tiene sentido sobre los atributos de texto. */
export const ATRIBUTOS_TEXTO: readonly AtributoSegmento[] = [
  'cliente',
  'sucursal',
  'colonia',
  'ciudad',
  'estado',
]

export interface ReglaSegmento {
  attr: AtributoSegmento
  op: OperadorSegmento
  value: string
}

export type TipoAudiencia =
  | 'ALL'
  | 'NEW_CUSTOMERS'
  | 'EXISTING_CUSTOMERS'
  | 'SOURCE'
  /** Declarado en el enum pero nunca califica: los referidos están fuera de alcance. */
  | 'REFERRAL'
  | 'SEGMENT'

export interface Campania {
  id: string
  name: string
  title: string
  description: string | null
  customerMessage: string | null
  discountType: TipoDescuento
  discountValue: number
  minimumOrderAmount: number
  maximumOrderAmount: number | null
  startsAt: string | null
  endsAt: string | null
  /** 0 = sin límite. */
  usageLimitTotal: number
  usageLimitPerCustomer: number
  targetType: TipoAudiencia
  sourceCode: string | null
  segmentRules: ReglaSegmento[]
  categorias: string[]
  isActive: boolean
  generados: number
  utilizados: number
  porcentajeUtilizacion: number
}

export type TipoFuente =
  'FACEBOOK' | 'INSTAGRAM' | 'INFLUENCER' | 'QR' | 'REFERIDO' | 'GOOGLE' | 'OTRO'

export interface Fuente {
  id: string
  name: string
  type: TipoFuente
  code: string
  isActive: boolean
  /** Enlace único para repartir: rapidix.mx/r/CODIGO. */
  enlace: string
  clientesAtribuidos: number
}

export interface FilaMetrica {
  origen: string
  sourceCode: string
  titulo: string
  generados: number
  utilizados: number
  porcentajeUtilizacion: number
  descuentoOtorgado: number
}

export interface MetricasCupones {
  resumen: {
    generados: number
    utilizados: number
    porcentajeUtilizacion: number
    descuentoTotalOtorgado: number
    clientesConCupon: number
    activos: number
    vencidos: number
    cancelados: number
  }
  porTipo: FilaMetrica[]
}

// ------------------------------------------------------------------
// Administración → Clientes (añadido por el SPEC 02, paso 1)
// ------------------------------------------------------------------

export interface ClienteAdmin {
  id: string
  nombre: string
  telefono: string
  ciudad: string | null
  estado: string | null
  pedidos: number
  totalGastado: number
  ultimoPedido: string | null
  creado: string
  fuenteCodigo: string | null
  nivel: string | null
}

export interface PaginaClientes {
  datos: ClienteAdmin[]
  total: number
  pagina: number
  porPagina: number
}

/**
 * Quien se registró por WhatsApp y todavía no ha comprado.
 *
 * No es un cliente: se es cliente al hacer el primer pedido, y en ese momento
 * desaparece de esta lista y aparece en la de clientes.
 */
export interface ProspectoAdmin {
  id: string
  nombre: string
  telefono: string
  ciudad: string | null
  estado: string | null
  tieneDireccion: boolean
  fuenteCodigo: string | null
  creado: string
}

export interface PaginaProspectos {
  datos: ProspectoAdmin[]
  total: number
  pagina: number
  porPagina: number
}

// ------------------------------------------------------------------
// Inventario y movimientos de bodega
// ------------------------------------------------------------------

/** Entrada o salida de bodega. */
export type TipoMovimiento = 'ENTRADA' | 'SALIDA'

/**
 * Cuál de los dos saldos toca el movimiento.
 *
 * `AMBOS` es lo normal. `FISICO` es mercancía que llegó pero no se libera a
 * venta —cuarentena—, y `APT` aparta o libera lo que ya está en piso sin que
 * entre ni salga nada de la bodega.
 */
export type AfectaInventario = 'AMBOS' | 'FISICO' | 'APT'

/**
 * Por qué se movió. Catálogo cerrado, para poder agrupar por causa. `VENTA`,
 * `ENTREGA` y `RUTA` los escribe el pedido: la venta aparta (baja el apt.), la
 * entrega en tienda saca la mercancía de bodega (baja el físico) y la ruta la
 * sube al camión al recolectar (baja el físico) o la regresa (lo sube).
 * `TRANSFERENCIA` lo escribe la transferencia a una tienda: aparta al crearse
 * (baja el apt.) y saca la mercancía cuando la tienda la acepta (baja el físico).
 */
export type MotivoMovimiento =
  | 'COMPRA'
  | 'VENTA'
  | 'MERMA'
  | 'TRASPASO'
  | 'AJUSTE'
  | 'DEVOLUCION'
  | 'ENTREGA'
  | 'RUTA'
  | 'TRANSFERENCIA'

/** Una fila de la ventana de Inventario. */
export interface SaldoProducto {
  id: string
  nombre: string
  categoria: string
  unidad: string
  inventario: number
  aptInventario: number
  /** Lo que va arriba de los camiones ahora mismo. Ya salió del físico al recolectarse. */
  inventarioEnRuta: number
  /** Físico menos apartado: lo que delata un descuadre. */
  diferencia: number
  agotado: boolean
}

/**
 * Un renglón de la bitácora.
 *
 * Lleva los cuatro saldos congelados del instante en que se aplicó, así que se
 * explica solo aunque después alguien haya vuelto a mover el mismo producto.
 */
export interface MovimientoInventario {
  id: string
  productoId: string
  producto: string
  tipo: TipoMovimiento
  afecta: AfectaInventario
  motivo: MotivoMovimiento
  cantidad: number
  empleado: string
  observaciones: string | null
  /** Quién estaba logueado. Null cuando el movimiento lo generó una venta. */
  usuarioNombre: string | null
  pedidoId: string | null
  fisicoAntes: number
  fisicoDespues: number
  aptAntes: number
  aptDespues: number
  creadoEn: string
}

/** Lo que devuelve `POST /admin/inventario/movimientos`. */
export interface ResumenLote {
  productos: number
  piezas: number
  movimientos: MovimientoInventario[]
}

// ------------------------------------------------------------------
// Tiendas, su inventario y las transferencias desde bodega
// ------------------------------------------------------------------

/** Una tienda física: se da de alta en Configuración → Tiendas. */
export interface Tienda {
  id: string
  nombre: string
  direccion: string
  responsable: string
  /** Una tienda no se borra: apagada, deja de ofrecerse como destino. */
  activa: boolean
}

/**
 * `PENDIENTE`: bodega ya la apartó y la tienda aún no la recibe. `ACEPTADA`:
 * salió del físico de bodega y entró al inventario de la tienda.
 */
export type EstadoTransferencia = 'PENDIENTE' | 'ACEPTADA' | 'CANCELADA'

/** Mercancía que bodega manda a una tienda; la tienda la «recolecta» al aceptarla. */
export interface Transferencia {
  id: string
  folio: string
  estado: EstadoTransferencia
  tienda: { id: string; nombre: string }
  empleado: string
  observaciones: string | null
  creadaPor: string | null
  creadoEn: string
  resueltaPor: string | null
  resueltaEn: string | null
  piezas: number
  lineas: { productoId: string; producto: string; unidad: string; cantidad: number }[]
}

/** El cliente tal como lo necesita el mostrador del punto de venta. */
export interface ClientePdv {
  id: string
  nombre: string
  telefono: string
  /** Todavía no ha comprado: este pedido lo convierte en cliente. */
  esNuevo: boolean
  saldoBilletera: number
  /** La dirección de su perfil en una línea; `null` si no está completa. */
  direccion: string | null
}

/**
 * Un turno de caja del punto de venta: de «Crear turno» al corte de caja.
 * Los totales los calcula la API; aquí no se suma nada.
 */
export interface TurnoPdv {
  id: string
  folio: string
  tienda: { id: string; nombre: string }
  cajero: string
  abiertoEn: string
  /** `null` mientras el turno sigue abierto. */
  cerradoEn: string | null
  totales: {
    pedidos: number
    /** Entregados y cobrados en el mostrador: los que suman a la caja. */
    cobrados: number
    /** Para llevar sin entregar: impiden hacer el corte. */
    porEntregar: number
    /** Salen por Rutas: su dinero no pasa por esta caja. */
    aDomicilio: number
    cancelados: number
    ventas: number
    efectivo: number
    transferencia: number
    billetera: number
  }
  /** Lo que el cajero contó en el corte. */
  efectivoDeclarado: number | null
  /** Declarado menos calculado: negativo es faltante. */
  diferencia: number | null
  notas: string | null
}

export type TurnoPdvConPedidos = TurnoPdv & { pedidos: Pedido[] }

/** Una fila del inventario de una tienda. */
export interface ExistenciaTienda {
  productoId: string
  nombre: string
  categoria: string
  unidad: string
  cantidad: number
}
