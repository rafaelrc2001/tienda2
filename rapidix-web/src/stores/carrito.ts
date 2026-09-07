import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { http } from '@/api/http'
import type { LineaCarrito, Pedido, PrevisualizacionCarrito, ResultadoCupon } from '@/api/tipos'

const CLAVE_CARRITO = 'rapidix.carrito'

interface CarritoGuardado {
  lineas: LineaCarrito[]
  codigoCupon: string | null
}

function leerGuardado(): CarritoGuardado {
  try {
    const crudo = localStorage.getItem(CLAVE_CARRITO)
    if (!crudo) return { lineas: [], codigoCupon: null }
    const datos = JSON.parse(crudo) as Partial<CarritoGuardado>
    return {
      lineas: Array.isArray(datos.lineas)
        ? datos.lineas.filter(
            (l): l is LineaCarrito =>
              typeof l?.productoId === 'string' && typeof l?.cantidad === 'number' && l.cantidad > 0,
          )
        : [],
      codigoCupon: typeof datos.codigoCupon === 'string' ? datos.codigoCupon : null,
    }
  } catch {
    return { lineas: [], codigoCupon: null }
  }
}

/**
 * Carrito del cliente (SPEC 02 §3.2).
 *
 * Guarda **solo `productoId` y `cantidad`**, nunca precios: un carrito que
 * sobrevive tres días en `localStorage` no puede llevar precios congelados
 * dentro. El desglose siempre lo recalcula la API.
 */
export const useCarritoStore = defineStore('carrito', () => {
  const guardado = leerGuardado()

  const lineas = ref<LineaCarrito[]>(guardado.lineas)
  const codigoCupon = ref<string | null>(guardado.codigoCupon)
  /** Nunca se persiste: se recalcula en cada cambio. */
  const previsualizacion = ref<PrevisualizacionCarrito | null>(null)
  const calculando = ref(false)
  /** Motivo por el que la API rechazó el cupón, para el campo del cupón. */
  const errorCupon = ref('')

  /** Secuencia de las llamadas a `previsualizar`, para descartar las viejas. */
  let ultimaPeticion = 0

  const vacio = computed(() => lineas.value.length === 0)
  const totalPiezas = computed(() => lineas.value.reduce((s, l) => s + l.cantidad, 0))

  function cantidadDe(productoId: string): number {
    return lineas.value.find((l) => l.productoId === productoId)?.cantidad ?? 0
  }

  function persistir(): void {
    try {
      localStorage.setItem(
        CLAVE_CARRITO,
        JSON.stringify({ lineas: lineas.value, codigoCupon: codigoCupon.value }),
      )
    } catch {
      // Almacenamiento bloqueado: el carrito dura lo que la pestaña.
    }
  }

  function fijarCantidad(productoId: string, cantidad: number): void {
    const indice = lineas.value.findIndex((l) => l.productoId === productoId)
    if (cantidad <= 0) {
      if (indice >= 0) lineas.value.splice(indice, 1)
    } else if (indice >= 0) {
      lineas.value[indice].cantidad = cantidad
    } else {
      lineas.value.push({ productoId, cantidad })
    }
    persistir()
  }

  const agregar = (productoId: string): void =>
    fijarCantidad(productoId, cantidadDe(productoId) + 1)

  const quitar = (productoId: string): void => fijarCantidad(productoId, cantidadDe(productoId) - 1)

  function vaciar(): void {
    lineas.value = []
    codigoCupon.value = null
    previsualizacion.value = null
    errorCupon.value = ''
    persistir()
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
    vaciar()
    return pedido
  }

  return {
    lineas,
    codigoCupon,
    previsualizacion,
    calculando,
    errorCupon,
    vacio,
    totalPiezas,
    cantidadDe,
    agregar,
    quitar,
    fijarCantidad,
    vaciar,
    recalcular,
    aplicarCupon,
    quitarCupon,
    confirmar,
  }
})
