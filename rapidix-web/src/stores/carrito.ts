import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { http } from '@/api/http'
import type {
  CarritoGuardado,
  DireccionEntrega,
  ItemPrevisualizado,
  LineaCalculada,
  LineaCarrito,
  MetasCarrito,
  MetodoEntrega,
  MetodoPago,
  Pedido,
  PrevisualizacionCarrito,
  ResultadoCupon,
  SubtotalCarrito,
} from '@/api/tipos'

const CLAVE_CARRITO = 'rapidix.carrito'

/**
 * Lo que se espera a que el cliente deje de tocar el «+» antes de mandar el
 * carrito al servidor. Sincronizar en cada pulsación serían diez peticiones
 * para llegar a la misma línea de diez piezas.
 */
const RETRASO_SINCRONIZACION = 1500

interface CarritoLocal {
  lineas: LineaCarrito[]
  codigoCupon: string | null
  /**
   * Quién armó este carrito. `null` es un visitante sin sesión.
   *
   * Sin esto, dos personas que entran desde el mismo teléfono comparten la
   * compra a medias de la anterior: al abrir sesión se compara con el dueño de
   * la sesión y, si no coincide, el carrito guardado se descarta (HU-13).
   */
  duenio: string | null
  /** Se recuerda al recargar o al volver al carrito (HU-01). */
  metodoEntrega: MetodoEntrega
  /**
   * Lo que el cliente capturó como dirección de ESTE pedido (HU-04).
   * `null` mientras no la toque: entonces el checkout parte del perfil.
   */
  direccion: DireccionEntrega | null
}

/** Descarta un borrador guardado con otra forma en vez de romper el checkout. */
function leerDireccion(valor: unknown): DireccionEntrega | null {
  if (typeof valor !== 'object' || valor === null) return null
  const d = valor as Record<string, unknown>
  const texto = (v: unknown): string => (typeof v === 'string' ? v : '')
  const numero = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null
  return {
    quienRecibe: texto(d.quienRecibe),
    telefono: texto(d.telefono),
    calle: texto(d.calle),
    colonia: texto(d.colonia),
    cp: texto(d.cp),
    ciudad: texto(d.ciudad),
    estado: texto(d.estado),
    referencias: texto(d.referencias),
    lat: numero(d.lat),
    lng: numero(d.lng),
  }
}

function leerGuardado(): CarritoLocal {
  const vacio: CarritoLocal = {
    lineas: [],
    codigoCupon: null,
    duenio: null,
    metodoEntrega: 'DOMICILIO',
    direccion: null,
  }
  try {
    const crudo = localStorage.getItem(CLAVE_CARRITO)
    if (!crudo) return vacio
    const datos = JSON.parse(crudo) as Partial<CarritoLocal>
    return {
      lineas: Array.isArray(datos.lineas)
        ? datos.lineas.filter(
            (l): l is LineaCarrito =>
              typeof l?.productoId === 'string' && typeof l?.cantidad === 'number' && l.cantidad > 0,
          )
        : [],
      codigoCupon: typeof datos.codigoCupon === 'string' ? datos.codigoCupon : null,
      duenio: typeof datos.duenio === 'string' ? datos.duenio : null,
      metodoEntrega: datos.metodoEntrega === 'TIENDA' ? 'TIENDA' : 'DOMICILIO',
      direccion: leerDireccion(datos.direccion),
    }
  } catch {
    return vacio
  }
}

/**
 * Carrito del cliente (SPEC 02 §3.2).
 *
 * Guarda **solo `productoId` y `cantidad`**, nunca precios: un carrito que
 * sobrevive tres días en `localStorage` no puede llevar precios congelados
 * dentro. El desglose siempre lo recalcula la API.
 *
 * Vive en tres sitios y en este orden de autoridad: la memoria de la pestaña
 * manda mientras está abierta, `localStorage` la sobrevive, y el servidor es la
 * copia que permite seguir la compra desde otro teléfono (HU-13).
 */
export const useCarritoStore = defineStore('carrito', () => {
  const guardado = leerGuardado()

  const lineas = ref<LineaCarrito[]>(guardado.lineas)
  const codigoCupon = ref<string | null>(guardado.codigoCupon)
  const duenio = ref<string | null>(guardado.duenio)
  /** Nunca se persiste: se recalcula en cada cambio. */
  const previsualizacion = ref<PrevisualizacionCarrito | null>(null)
  /**
   * Importe para quien todavía no tiene sesión.
   *
   * `POST /carrito/previsualizar` exige ser cliente —calcula envío, cupón y
   * cashback de su nivel—, así que el visitante pide `POST /carrito/subtotal`.
   * Sigue siendo la API la que pone el precio: aquí no se multiplica nada.
   */
  const importePublico = ref<SubtotalCarrito | null>(null)
  const calculando = ref(false)
  /** Motivo por el que la API rechazó el cupón, para el campo del cupón. */
  const errorCupon = ref('')

  /*
   * Pago (HU-09 a HU-12). Vive solo en memoria, a propósito: `localStorage`
   * guarda lo que se compra, no cómo se paga. Un monto de efectivo de hace tres
   * días no vale para el total de hoy. La entrega sí se guarda: es a dónde se
   * lleva, y no caduca con el total.
   */
  /** Sin valor por defecto: el cliente elige. */
  const metodoPago = ref<MetodoPago | null>(null)
  /** Efectivo: con cuánto va a pagar. */
  const pagoCon = ref<number | null>(null)
  /** Saldo de billetera que quiere aplicar. */
  const usarBilletera = ref(0)
  /** A domicilio mientras no elija otra cosa: es lo que cobra envío. */
  const metodoEntrega = ref<MetodoEntrega>(guardado.metodoEntrega)
  /** Borrador de la dirección de este pedido. Nunca toca el perfil (HU-04). */
  const direccion = ref<DireccionEntrega | null>(guardado.direccion)

  /** Secuencia de las llamadas a la API, para descartar las viejas. */
  let ultimaPeticion = 0
  let temporizadorSync: ReturnType<typeof setTimeout> | null = null

  /**
   * El pago elegido deja confirmar. Lo decide la API en la previsualización:
   * aquí no se compara el monto de efectivo con el total.
   */
  const pagoListo = computed(() => {
    const pago = previsualizacion.value?.pago
    return !!pago && !pago.errorPago && !pago.errorBilletera
  })

  function olvidarPago(): void {
    metodoPago.value = null
    pagoCon.value = null
    usarBilletera.value = 0
  }

  function olvidarEntrega(): void {
    metodoEntrega.value = 'DOMICILIO'
    direccion.value = null
  }

  const vacio = computed(() => lineas.value.length === 0)
  const totalPiezas = computed(() => lineas.value.reduce((s, l) => s + l.cantidad, 0))

  /** Lo que suman los productos, venga del desglose completo o del público. */
  const subtotal = computed<number | null>(
    () => previsualizacion.value?.subtotal ?? importePublico.value?.subtotal ?? null,
  )

  /**
   * Cashback base que dejaría este carrito, sin el ×2 de la billetera (HU-12).
   * Al visitante se le estima con el nivel de entrada, que es el que ganaría
   * si comprara hoy. `null` mientras no se sepa.
   */
  const cashbackEstimado = computed<number | null>(
    () =>
      previsualizacion.value?.cashbackEstimado ?? importePublico.value?.cashbackEstimado ?? null,
  )

  /** Lo que le falta al carrito para el envío gratis y el cashback. */
  const metas = computed<MetasCarrito | null>(
    () => previsualizacion.value?.metas ?? importePublico.value?.metas ?? null,
  )

  /**
   * Las líneas tal como las valoró la API, con nombre y precio escalonado.
   * Vacío mientras no haya respuesta: quien pinta decide si eso es «Cargando».
   */
  const lineasValoradas = computed<ItemPrevisualizado[]>(
    () => previsualizacion.value?.items ?? importePublico.value?.items ?? [],
  )

  function cantidadDe(productoId: string): number {
    return lineas.value.find((l) => l.productoId === productoId)?.cantidad ?? 0
  }

  /**
   * Precio escalonado de una línea tal como lo calculó la API (HU-08).
   *
   * Solo se devuelve si corresponde a la cantidad que hay ahora: entre un «+»
   * y la respuesta, la línea calculada es la de antes, y pintar «te faltan 1»
   * cuando esa pieza ya se añadió sería mentir durante medio segundo.
   */
  function lineaCalculada(productoId: string): LineaCalculada | null {
    const items: LineaCalculada[] =
      previsualizacion.value?.items ?? importePublico.value?.items ?? []
    const linea = items.find((i) => i.productoId === productoId)
    return linea && linea.cantidad === cantidadDe(productoId) ? linea : null
  }

  function persistir(): void {
    try {
      localStorage.setItem(
        CLAVE_CARRITO,
        JSON.stringify({
          lineas: lineas.value,
          codigoCupon: codigoCupon.value,
          duenio: duenio.value,
          metodoEntrega: metodoEntrega.value,
          direccion: direccion.value,
        }),
      )
    } catch {
      // Almacenamiento bloqueado: el carrito dura lo que la pestaña.
    }
  }

  // ------------------------------------------------------------------
  // Copia en el servidor (HU-13)
  // ------------------------------------------------------------------

  /**
   * Manda el carrito al servidor, en cuanto pare de cambiar.
   *
   * Si falla no se avisa de nada: es una copia de respaldo, y el carrito de la
   * pestaña sigue estando bien. Perder la copia molesta al cambiar de
   * dispositivo; enseñar un error de red por ello, más.
   */
  function programarSincronizacion(): void {
    if (!duenio.value) return
    if (temporizadorSync) clearTimeout(temporizadorSync)
    temporizadorSync = setTimeout(() => {
      temporizadorSync = null
      http
        .put('/perfil/carrito', {
          items: lineas.value,
          entrega: { metodoEntrega: metodoEntrega.value, direccion: direccion.value },
        })
        .catch(() => {})
    }, RETRASO_SINCRONIZACION)
  }

  function cancelarSincronizacion(): void {
    if (temporizadorSync) clearTimeout(temporizadorSync)
    temporizadorSync = null
  }

  /**
   * Ata el carrito a la sesión que acaba de abrirse.
   *
   * Tres casos, y los tres importan:
   *
   *  - **Otro dueño**: el carrito de quien usó antes este teléfono se descarta
   *    entero. Nadie debe encontrarse la compra de otro.
   *  - **Carrito de visitante**: lo que armó antes de entrar es suyo y se
   *    conserva —es justo lo que estaba haciendo cuando le pedimos el login
   *    (HU-14)—, y sube al servidor.
   *  - **Su propio carrito**: si en esta pestaña ya hay líneas, mandan ellas;
   *    si está vacío, se baja lo que dejó guardado.
   */
  async function adoptar(duenioId: string): Promise<void> {
    const ajeno = duenio.value !== null && duenio.value !== duenioId
    if (ajeno) {
      lineas.value = []
      codigoCupon.value = null
      previsualizacion.value = null
      importePublico.value = null
      errorCupon.value = ''
      olvidarPago()
      olvidarEntrega()
    }

    duenio.value = duenioId
    persistir()

    if (lineas.value.length > 0) {
      // Lo de esta pestaña es lo más reciente: se sube tal cual.
      programarSincronizacion()
      return
    }

    try {
      const remoto = await http.get<CarritoGuardado>('/perfil/carrito')
      // Entre la petición y la respuesta puede haber añadido algo: lo que hizo
      // aquí gana siempre sobre lo que estaba guardado.
      if (remoto.items.length > 0 && lineas.value.length === 0) {
        lineas.value = remoto.items
        // El borrador de entrega viaja con el carrito, salvo que aquí ya haya uno.
        if (remoto.entrega && !direccion.value) {
          if (remoto.entrega.metodoEntrega) metodoEntrega.value = remoto.entrega.metodoEntrega
          direccion.value = leerDireccion(remoto.entrega.direccion)
        }
        persistir()
        await refrescarImporte().catch(() => {})
      }
    } catch {
      // Sin copia remota se sigue con lo que haya en el navegador.
    }
  }

  /**
   * Olvida el carrito sin tocar el del servidor.
   *
   * Es lo que hace el cierre de sesión: la copia guardada tiene que seguir ahí
   * cuando esa persona vuelva a entrar. Vaciar de verdad es `vaciar()`.
   */
  function olvidar(): void {
    cancelarSincronizacion()
    lineas.value = []
    codigoCupon.value = null
    duenio.value = null
    previsualizacion.value = null
    importePublico.value = null
    errorCupon.value = ''
    olvidarPago()
    olvidarEntrega()
    persistir()
  }

  // ------------------------------------------------------------------
  // Entrega
  // ------------------------------------------------------------------

  /** Cambia el método de entrega y lo recuerda. El envío nuevo lo dice `recalcular()`. */
  function fijarEntrega(entrega: MetodoEntrega): void {
    metodoEntrega.value = entrega
    persistir()
    programarSincronizacion()
  }

  /**
   * Guarda la dirección que el cliente va escribiendo para este pedido.
   *
   * Va al borrador local y a su respaldo en el servidor, **nunca al perfil**:
   * el perfil solo cambia con el botón explícito del checkout (HU-05).
   */
  function fijarDireccion(nueva: DireccionEntrega): void {
    direccion.value = { ...nueva }
    persistir()
    programarSincronizacion()
  }

  // ------------------------------------------------------------------
  // Cantidades
  // ------------------------------------------------------------------

  /**
   * Fija la cantidad de un producto.
   *
   * `maximo` es el saldo liberado para venta, y solo lo manda la Tienda cuando
   * el negocio tiene encendido el control de inventario: apagado, todos los
   * productos están en cero y topar ahí sería no dejar comprar nada (HU-07).
   */
  function fijarCantidad(productoId: string, cantidad: number, maximo?: number): void {
    const tope = maximo === undefined ? cantidad : Math.min(cantidad, maximo)
    const final = Math.max(0, Math.floor(Number.isFinite(tope) ? tope : 0))

    const indice = lineas.value.findIndex((l) => l.productoId === productoId)
    if (final <= 0) {
      if (indice >= 0) lineas.value.splice(indice, 1)
    } else if (indice >= 0) {
      lineas.value[indice].cantidad = final
    } else {
      lineas.value.push({ productoId, cantidad: final })
    }
    persistir()
    programarSincronizacion()
  }

  const agregar = (productoId: string, maximo?: number): void =>
    fijarCantidad(productoId, cantidadDe(productoId) + 1, maximo)

  const quitar = (productoId: string): void => fijarCantidad(productoId, cantidadDe(productoId) - 1)

  /** Vacía el carrito, aquí y en el servidor. */
  function vaciar(): void {
    lineas.value = []
    codigoCupon.value = null
    previsualizacion.value = null
    importePublico.value = null
    errorCupon.value = ''
    olvidarPago()
    persistir()
    programarSincronizacion()
  }

  /**
   * «Vaciar carrito» del widget del header: las tres capas, sin esperar.
   *
   * `vaciar()` deja la copia del servidor al debounce porque casi siempre va
   * seguido de volver a llenar (repetir pedido). Aquí el cliente quiere
   * empezar de cero ya, así que el `PUT` sale en el acto. Si la red falla, lo
   * local ya está vacío y no se avisa: la copia remota es solo respaldo.
   */
  async function vaciarAhora(): Promise<void> {
    vaciar()
    cancelarSincronizacion()
    if (!duenio.value) return
    await http.put('/perfil/carrito', { items: [] }).catch(() => {})
  }

  // ------------------------------------------------------------------
  // Importes
  // ------------------------------------------------------------------

  /**
   * Quita las líneas de productos que la API ya no encuentra (borrados).
   *
   * Las dos respuestas de importes traen en `items` todo producto que sigue
   * existiendo, agotados incluidos: lo que se mandó y no volvió ya no se vende.
   * Si se quedara aquí, el contador del carrito lo seguiría sumando y el cupón y
   * el pedido —que no toleran faltantes— responderían «ya no existen». Solo se
   * miran los ids de ESA petición: lo añadido mientras tanto no se toca.
   */
  function quitarInexistentes(enviados: string[], items: { productoId: string }[]): void {
    const vivos = new Set(items.map((i) => i.productoId))
    const borrados = new Set(enviados.filter((id) => !vivos.has(id)))
    if (borrados.size === 0) return
    lineas.value = lineas.value.filter((l) => !borrados.has(l.productoId))
    persistir()
    programarSincronizacion()
  }

  /**
   * Pide a la API lo que cuesta el carrito.
   *
   * Con sesión de cliente pide el desglose entero —envío, recargo, cupón y
   * cashback—; sin ella, solo el subtotal, que es lo único que la Tienda puede
   * enseñar a un visitante. La interfaz no reproduce ni una de esas reglas: las
   * pregunta.
   */
  async function refrescarImporte(): Promise<void> {
    if (duenio.value) return recalcular()

    if (vacio.value) {
      importePublico.value = null
      return
    }

    const miPeticion = ++ultimaPeticion
    const enviados = lineas.value.map((l) => l.productoId)
    calculando.value = true
    try {
      const respuesta = await http.post<SubtotalCarrito>('/carrito/subtotal', {
        items: lineas.value,
      })
      if (miPeticion !== ultimaPeticion) return
      importePublico.value = respuesta
      quitarInexistentes(enviados, respuesta.items)
    } finally {
      if (miPeticion === ultimaPeticion) calculando.value = false
    }
  }

  /**
   * Pide a la API el desglose del carrito.
   *
   * Se llama en cada cambio de cantidad o de cupón. La interfaz no reproduce
   * ni una regla de envío, recargo o cashback: las pregunta.
   */
  async function recalcular(): Promise<void> {
    if (vacio.value) {
      previsualizacion.value = null
      return
    }

    // Pulsar "+" varias veces seguidas lanza varias peticiones y pueden
    // volver desordenadas: solo la última manda sobre el desglose.
    const miPeticion = ++ultimaPeticion
    const enviados = lineas.value.map((l) => l.productoId)
    calculando.value = true
    try {
      const respuesta = await http.post<PrevisualizacionCarrito>('/carrito/previsualizar', {
        items: lineas.value,
        codigoCupon: codigoCupon.value ?? undefined,
        metodoPago: metodoPago.value ?? undefined,
        pagoCon: pagoCon.value ?? undefined,
        usarBilletera: usarBilletera.value > 0 ? usarBilletera.value : undefined,
        metodoEntrega: metodoEntrega.value,
      })
      if (miPeticion !== ultimaPeticion) return

      previsualizacion.value = respuesta
      quitarInexistentes(enviados, respuesta.items)
      // Si el cupón dejó de valer —cambió una cantidad y ya no llega al
      // mínimo, venció…—, la API lo devuelve como `cupon: null`. Se quita, con
      // el motivo a la vista: seguir mandándolo solo repetiría el rechazo, y
      // confirmar con él daría un 400 (HU-10).
      if (codigoCupon.value && !respuesta.cupon) {
        const motivo = respuesta.avisos.at(-1) ?? 'ya no se puede aplicar.'
        errorCupon.value = `Quitamos el cupón ${codigoCupon.value}: ${motivo}`
        codigoCupon.value = null
        persistir()
      }
    } finally {
      if (miPeticion === ultimaPeticion) calculando.value = false
    }
  }

  /**
   * Valida un cupón contra el carrito actual.
   *
   * La API responde 200 tanto si vale como si no: el motivo del rechazo se
   * pinta en el campo del cupón, no como toast genérico.
   */
  async function aplicarCupon(codigo: string): Promise<boolean> {
    const limpio = codigo.trim().toUpperCase()
    if (!limpio) return false

    const resultado = await http.post<ResultadoCupon>('/carrito/validar-cupon', {
      codigo: limpio,
      items: lineas.value,
    })

    if (!resultado.valido) {
      errorCupon.value = resultado.mensaje
      return false
    }

    codigoCupon.value = limpio
    errorCupon.value = ''
    persistir()
    await recalcular()
    return true
  }

  async function quitarCupon(): Promise<void> {
    codigoCupon.value = null
    errorCupon.value = ''
    persistir()
    await recalcular()
  }

  /**
   * Confirma el pedido. El carrito se vacía **solo tras el 201**: si la API
   * rechaza, el cliente conserva lo que había armado.
   */
  async function confirmar(
    aceptaTerminos: boolean,
    direccionPedido: DireccionEntrega | null,
  ): Promise<Pedido> {
    // La API vuelve a calcular todo —precios, envío, cupón, billetera y
    // cambio—: de aquí solo salen las elecciones del cliente.
    const pedido = await http.post<Pedido>('/pedidos', {
      items: lineas.value,
      codigoCupon: codigoCupon.value ?? undefined,
      metodoPago: metodoPago.value ?? undefined,
      pagoCon: metodoPago.value === 'EFECTIVO' ? (pagoCon.value ?? undefined) : undefined,
      usarBilletera: usarBilletera.value > 0 ? usarBilletera.value : undefined,
      metodoEntrega: metodoEntrega.value,
      // Copia completa, con el pin: el pedido no vuelve a leer el perfil (HU-11).
      direccion: metodoEntrega.value === 'DOMICILIO' ? (direccionPedido ?? undefined) : undefined,
      aceptaTerminos,
    })
    // El servidor ya borró su copia dentro de la transacción del pedido: aquí
    // sobra volver a mandarla.
    cancelarSincronizacion()
    lineas.value = []
    codigoCupon.value = null
    previsualizacion.value = null
    importePublico.value = null
    errorCupon.value = ''
    olvidarPago()
    // La dirección quedó copiada en el pedido; el próximo parte del perfil.
    // El método de entrega se queda: es una preferencia, no un borrador.
    direccion.value = null
    persistir()
    return pedido
  }

  return {
    lineas,
    codigoCupon,
    duenio,
    previsualizacion,
    subtotal,
    cashbackEstimado,
    metas,
    calculando,
    errorCupon,
    metodoPago,
    pagoCon,
    usarBilletera,
    metodoEntrega,
    direccion,
    pagoListo,
    vacio,
    totalPiezas,
    lineasValoradas,
    cantidadDe,
    lineaCalculada,
    agregar,
    quitar,
    fijarCantidad,
    vaciar,
    vaciarAhora,
    olvidar,
    adoptar,
    fijarEntrega,
    fijarDireccion,
    refrescarImporte,
    recalcular,
    aplicarCupon,
    quitarCupon,
    confirmar,
  }
})
