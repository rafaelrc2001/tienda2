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

/** Las nueve secciones de `PERMISOS_POR_ROL`. */
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

export interface Producto {
  id: string
  nombre: string
  categoria: string
  unidad: string
  precioCosto: number
  precioVenta: number
  imagenUrl: string | null
  agotado: boolean
  /** Existencia física en bodega. Solo se mueve desde Movimientos. */
  inventario: number
  /** Lo liberado para venta: el saldo del que descuenta un pedido. */
  aptInventario: number
}

export interface CategoriaConProductos {
  categoria: string
  productos: Producto[]
}

// ------------------------------------------------------------------
// Carrito y pedido
// ------------------------------------------------------------------

/** Lo que el carrito manda a la API: nunca precios, solo id y cantidad. */
export interface LineaCarrito {
  productoId: string
  cantidad: number
}

export interface ItemPrevisualizado {
  productoId: string
  nombre: string
  unidad: string
  precioUnitario: number
  cantidad: number
  importe: number
  /** El producto se agotó después de meterlo al carrito. */
  agotado: boolean
}

/** Respuesta de `POST /carrito/previsualizar`. */
export interface PrevisualizacionCarrito {
  items: ItemPrevisualizado[]
  subtotal: number
  envio: number
  recargoFuera: number
  descuento: number
  total: number
  cashbackEstimado: number
  cupon: { codigo: string; descripcion: string } | null
  dentroDeHorario: boolean
  /** false si el carrito no se puede confirmar tal y como está. */
  puedePedir: boolean
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
  estado: string
  cupon: { code: string; titulo: string } | null
  items: ItemPedido[]
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
  /** Porcentaje de cashback sobre el subtotal. */
  multiplicadorCashback: number
  montoMinimoCashback: number
  /** Si un pedido descuenta existencias de la bodega. */
  controlInventario: boolean
}

export interface Bancarios {
  banco: string | null
  beneficiario: string | null
  numeroCuenta: string | null
}

/**
 * Nivel de fidelidad. No existen en el Word ni en el prototipo: se configuran
 * aquí, y los umbrales del seed son provisionales.
 */
export interface NivelFidelidad {
  id: string
  nombre: string
  umbralGasto: number | string
  orden: number
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
  | 'FACEBOOK'
  | 'INSTAGRAM'
  | 'INFLUENCER'
  | 'QR'
  | 'REFERIDO'
  | 'GOOGLE'
  | 'OTRO'

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

/** Por qué se movió. Catálogo cerrado, para poder agrupar por causa. */
export type MotivoMovimiento =
  | 'COMPRA'
  | 'VENTA'
  | 'MERMA'
  | 'TRASPASO'
  | 'AJUSTE'
  | 'DEVOLUCION'

/** Una fila de la ventana de Inventario. */
export interface SaldoProducto {
  id: string
  nombre: string
  categoria: string
  unidad: string
  inventario: number
  aptInventario: number
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
