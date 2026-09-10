import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { http } from '@/api/http'
import type {
  CarritoGuardado,
  LineaCarrito,
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
}

function leerGuardado(): CarritoLocal {
  const vacio: CarritoLocal = { lineas: [], codigoCupon: null, duenio: null }
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
   * Subtotal para quien todavía no tiene sesión.
   *
   * `POST /carrito/previsualizar` exige ser cliente —calcula envío, cupón y
   * cashback—, así que el visitante pide solo lo que suman los productos. Sigue
   * siendo la API la que pone el precio: aquí no se multiplica nada.
   */
  const subtotalPublico = ref<number | null>(null)
  const calculando = ref(false)
  /** Motivo por el que la API rechazó el cupón, para el campo del cupón. */
  const errorCupon = ref('')

  /** Secuencia de las llamadas a la API, para descartar las viejas. */
  let ultimaPeticion = 0
  let temporizadorSync: ReturnType<typeof setTimeout> | null = null

  const vacio = computed(() => lineas.value.length === 0)
  const totalPiezas = computed(() => lineas.value.reduce((s, l) => s + l.cantidad, 0))

  /** Lo que suman los productos, venga del desglose completo o del público. */
  const subtotal = computed<number | null>(
    () => previsualizacion.value?.subtotal ?? subtotalPublico.value,
  )

  /**
   * Cashback que dejaría este carrito. `null` mientras no se sepa: sin sesión
   * no hay a quién acreditárselo, y el chip no se pinta (HU-12).
   */
  const cashbackEstimado = computed<number | null>(
    () => previsualizacion.value?.cashbackEstimado ?? null,
  )

  function cantidadDe(productoId: string): number {
    return lineas.value.find((l) => l.productoId === productoId)?.cantidad ?? 0
  }

  function persistir(): void {
    try {
      localStorage.setItem(
        CLAVE_CARRITO,
        JSON.stringify({
          lineas: lineas.value,
          codigoCupon: codigoCupon.value,
          duenio: duenio.value,
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
      http.put('/perfil/carrito', { items: lineas.value }).catch(() => {})
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
      subtotalPublico.value = null
      errorCupon.value = ''
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
    subtotalPublico.value = null
    errorCupon.value = ''
    persistir()
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
    subtotalPublico.value = null
    errorCupon.value = ''
    persistir()
    programarSincronizacion()
  }

  // ------------------------------------------------------------------
  // Importes
  // ------------------------------------------------------------------

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
      subtotalPublico.value = null
      return
    }

    const miPeticion = ++ultimaPeticion
    calculando.value = true
    try {
      const respuesta = await http.post<SubtotalCarrito>('/carrito/subtotal', {
        items: lineas.value,
      })
      if (miPeticion !== ultimaPeticion) return
      subtotalPublico.value = respuesta.subtotal
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
    calculando.value = true
    try {
      const respuesta = await http.post<PrevisualizacionCarrito>('/carrito/previsualizar', {
        items: lineas.value,
        codigoCupon: codigoCupon.value ?? undefined,
      })
      if (miPeticion !== ultimaPeticion) return

      previsualizacion.value = respuesta
      // Si el cupón dejó de valer, la API lo devuelve como `cupon: null`.
      if (codigoCupon.value && !respuesta.cupon) {
        errorCupon.value = respuesta.avisos.at(-1) ?? 'Ese cupón ya no se puede aplicar.'
      } else {
        errorCupon.value = ''
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
  async function confirmar(): Promise<Pedido> {
    const pedido = await http.post<Pedido>('/pedidos', {
      items: lineas.value,
      codigoCupon: codigoCupon.value ?? undefined,
    })
    // El servidor ya borró su copia dentro de la transacción del pedido: aquí
    // sobra volver a mandarla.
    cancelarSincronizacion()
    lineas.value = []
    codigoCupon.value = null
    previsualizacion.value = null
    subtotalPublico.value = null
    errorCupon.value = ''
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
    calculando,
    errorCupon,
    vacio,
    totalPiezas,
    cantidadDe,
    agregar,
    quitar,
    fijarCantidad,
    vaciar,
    olvidar,
    adoptar,
    refrescarImporte,
    recalcular,
    aplicarCupon,
    quitarCupon,
    confirmar,
  }
})
