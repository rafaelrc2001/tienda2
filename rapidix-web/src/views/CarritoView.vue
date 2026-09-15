<script setup lang="ts">
/**
 * Carrito y confirmación del pedido (Word 4.3 y 6.3).
 *
 * El desglose sale entero de `POST /carrito/previsualizar` y se recalcula en
 * cada cambio: **la interfaz no suma ni un peso**. Si al confirmar el total
 * difiere, manda el que devolvió el pedido.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCarritoStore } from '@/stores/carrito'
import { useUiStore } from '@/stores/ui'
import { dinero } from '@/utils/formato'
import { ErrorApi, http } from '@/api/http'
import type {
  Bancarios,
  DireccionEntrega,
  MetodoEntrega,
  MetodoPago,
  Pedido,
  Perfil,
} from '@/api/tipos'
import BloqueDireccionEntrega from '@/components/BloqueDireccionEntrega.vue'
import { direccionInicial, erroresDireccion, faltantesDireccion } from '@/utils/direccion'

const carrito = useCarritoStore()
const ui = useUiStore()

const cupon = ref(carrito.codigoCupon ?? '')
const aplicandoCupon = ref(false)
const confirmando = ref(false)
const pedidoHecho = ref<Pedido | null>(null)
const aceptaTerminos = ref(false)
/** Datos para la transferencia, pedidos la primera vez que se elige ese método. */
const bancarios = ref<Bancarios | null>(null)
const cargandoBancarios = ref(false)

const previsualizacion = computed(() => carrito.previsualizacion)
const pago = computed(() => previsualizacion.value?.pago ?? null)

/**
 * Lo que el cliente teclea en los montos, como texto: con `v-model.number`
 * un campo a medio escribir ("12.") salta mientras se escribe.
 */
const pagoConTexto = ref(carrito.pagoCon !== null ? String(carrito.pagoCon) : '')
const usaBilletera = ref(carrito.usarBilletera > 0)
const billeteraTexto = ref(carrito.usarBilletera > 0 ? String(carrito.usarBilletera) : '')

/** Si la billetera cubre el pedido entero no hay método que elegir. */
const cubiertoConBilletera = computed(
  () => !!previsualizacion.value && previsualizacion.value.aPagar === 0,
)

const METODOS = computed<{ valor: MetodoPago; titulo: string; detalle: string }[]>(() => [
  {
    valor: 'EFECTIVO',
    titulo: 'Efectivo',
    detalle: carrito.metodoEntrega === 'TIENDA' ? 'Pagas al recoger' : 'Pagas al recibir',
  },
  {
    valor: 'TRANSFERENCIA',
    titulo: 'Transferencia electrónica',
    detalle: 'Desde tu banco',
  },
])

const ENTREGAS: { valor: MetodoEntrega; titulo: string }[] = [
  { valor: 'TIENDA', titulo: 'Recoger en tienda' },
  { valor: 'DOMICILIO', titulo: 'Envío a domicilio' },
]

/** Fuera de horario con `atenderFuera` apagado no se puede confirmar. */
const motivoBloqueo = computed(() => {
  const p = previsualizacion.value
  if (!p || p.puedePedir) return ''
  if (!p.dentroDeHorario) {
    return (
      p.avisos.find((a) => a.includes('horario')) ?? 'Ahora mismo no estamos recibiendo pedidos.'
    )
  }
  if (p.items.some((i) => i.agotado)) {
    return 'Quita los productos agotados para poder confirmar tu pedido.'
  }
  return 'Tu carrito no se puede pedir todavía.'
})

// ---- Dirección de entrega (épica «Dirección de entrega») ----

/** El perfil solo aporta la dirección de partida y el texto del botón de guardarla. */
const perfil = ref<Perfil | null>(null)
/**
 * La dirección de este pedido. `null` hasta saber de dónde parte: el borrador
 * si lo hay, si no el perfil (que llega por API), si no vacía (HU-02).
 */
const direccion = ref<DireccionEntrega | null>(
  carrito.direccion ? direccionInicial(carrito.direccion, null) : null,
)
const bloqueDireccion = ref<InstanceType<typeof BloqueDireccionEntrega> | null>(null)
/** Tras tocar el aviso de «faltan datos», todo lo que falte se marca en rojo. */
const marcarErroresDireccion = ref(false)

const aDomicilio = computed(() => carrito.metodoEntrega === 'DOMICILIO')

async function cargarPerfil(): Promise<void> {
  try {
    perfil.value = await http.get<Perfil>('/perfil')
  } catch {
    // Sin perfil se captura a mano: el checkout no se bloquea por esto.
    perfil.value = null
  }
  if (!direccion.value) direccion.value = direccionInicial(carrito.direccion, perfil.value)
}

/** Cada cambio va al borrador del pedido, nunca al perfil (HU-04). */
function cambiarDireccion(nueva: DireccionEntrega): void {
  const cambioCp = nueva.cp !== direccion.value?.cp
  direccion.value = nueva
  carrito.fijarDireccion(nueva)
  // El envío podría depender de la zona: con un CP nuevo la API vuelve a calcular (HU-08).
  if (cambioCp && /^\d{5}$/.test(nueva.cp)) programarRecalculo()
}

/** A domicilio no se paga sin dirección válida; en tienda no se mira (HU-10). */
const direccionValida = computed(
  () =>
    !aDomicilio.value ||
    (!!direccion.value && Object.keys(erroresDireccion(direccion.value)).length === 0),
)

const motivoDireccion = computed(() => {
  if (motivoBloqueo.value || direccionValida.value) return ''
  if (!direccion.value) return 'Cargando tu dirección…'
  return `Completa tus datos de entrega: falta ${faltantesDireccion(direccion.value).join(', ')}.`
})

function revisarDireccion(): void {
  marcarErroresDireccion.value = true
  bloqueDireccion.value?.abrir()
}

/** Lo que falta para poder confirmar, en el orden en que el cliente lo resuelve. */
const motivoPago = computed(() => {
  if (motivoBloqueo.value || motivoDireccion.value || !pago.value) return ''
  const error = pago.value.errorBilletera ?? pago.value.errorPago
  if (error) return error.mensaje
  if (!aceptaTerminos.value) return 'Acepta el aviso de privacidad y los términos para continuar.'
  return ''
})

const puedeConfirmar = computed(
  () =>
    !confirmando.value &&
    !carrito.calculando &&
    !montoPendiente.value &&
    !!previsualizacion.value?.puedePedir &&
    direccionValida.value &&
    carrito.pagoListo &&
    aceptaTerminos.value,
)

function recalcular(): void {
  carrito.recalcular().catch((fallo) => ui.errorDeApi(fallo))
}

onMounted(() => {
  if (!carrito.vacio) recalcular()
  void cargarPerfil()
})

watch(() => carrito.lineas.map((l) => `${l.productoId}:${l.cantidad}`).join(','), recalcular)

// ---- Pago ----

/**
 * Los montos se mandan a la API cuando se deja de teclear: el cambio y el tope
 * de la billetera los calcula ella, y una petición por tecla sería ruido.
 * Mientras hay una pendiente, el botón de confirmar espera.
 */
const RETRASO_MONTO = 450
const montoPendiente = ref(false)
let temporizadorMonto: ReturnType<typeof setTimeout> | null = null

function programarRecalculo(): void {
  montoPendiente.value = true
  if (temporizadorMonto) clearTimeout(temporizadorMonto)
  temporizadorMonto = setTimeout(() => {
    temporizadorMonto = null
    montoPendiente.value = false
    recalcular()
  }, RETRASO_MONTO)
}

onBeforeUnmount(() => {
  if (temporizadorMonto) clearTimeout(temporizadorMonto)
})

/** "$1,200.50", "1200,5" o vacío → número o null. Solo lee, no redondea. */
function leerMonto(texto: string): number | null {
  const limpio = texto.replace(/[$\s,]/g, '')
  if (!limpio) return null
  const numero = Number(limpio)
  return Number.isFinite(numero) && numero >= 0 ? numero : null
}

function elegirMetodo(metodo: MetodoPago): void {
  if (carrito.metodoPago === metodo) return
  carrito.metodoPago = metodo
  if (metodo === 'TRANSFERENCIA') cargarBancarios()
  recalcular()
}

/** Cambiar la entrega mueve el envío: el total nuevo lo dice la API. */
function elegirEntrega(entrega: MetodoEntrega): void {
  if (carrito.metodoEntrega === entrega) return
  carrito.fijarEntrega(entrega)
  recalcular()
}

/**
 * Los datos bancarios salen de la configuración del negocio. Se piden una vez:
 * si fallan, el bloque lo dice y al confirmar se vuelve a intentar.
 */
async function cargarBancarios(): Promise<void> {
  if (bancarios.value || cargandoBancarios.value) return
  cargandoBancarios.value = true
  try {
    bancarios.value = await http
      .get<{ datosBancarios: Bancarios }>('/configuracion')
      .then((c) => c.datosBancarios)
  } catch {
    bancarios.value = null
  } finally {
    cargandoBancarios.value = false
  }
}

const hayBancarios = computed(
  () =>
    !!bancarios.value &&
    !!(bancarios.value.numeroCuenta || bancarios.value.clabe || bancarios.value.numeroTarjeta),
)

/** Copia un dato bancario. Sin permiso de portapapeles, el dato sigue seleccionable. */
async function copiar(texto: string, que: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(texto)
    ui.exito(`${que} copiada`)
  } catch {
    ui.error('No pudimos copiar. Mantén presionado el número para copiarlo.')
  }
}

// Si el método ya venía elegido (volver al carrito), los datos se piden igual.
if (carrito.metodoPago === 'TRANSFERENCIA') cargarBancarios()

watch(pagoConTexto, (texto) => {
  carrito.pagoCon = leerMonto(texto)
  programarRecalculo()
})

watch(billeteraTexto, (texto) => {
  if (!usaBilletera.value) return
  carrito.usarBilletera = leerMonto(texto) ?? 0
  programarRecalculo()
})

/**
 * Al encender la billetera se propone lo más que se puede usar: el saldo o
 * el total, lo que sea menor. Es solo la sugerencia del campo; el tope real lo
 * vuelve a aplicar la API.
 */
function alternarBilletera(): void {
  const p = previsualizacion.value
  if (usaBilletera.value && p) {
    billeteraTexto.value = String(Math.min(p.pago.saldoBilletera, p.total))
  } else {
    carrito.usarBilletera = 0
    billeteraTexto.value = ''
    recalcular()
  }
}

async function aplicarCupon(): Promise<void> {
  aplicandoCupon.value = true
  try {
    const valido = await carrito.aplicarCupon(cupon.value)
    if (valido) ui.exito('Cupón aplicado')
  } catch (fallo) {
    // Un fallo de red sí es un toast; el rechazo del cupón no llega aquí.
    ui.errorDeApi(fallo)
  } finally {
    aplicandoCupon.value = false
  }
}

async function quitarCupon(): Promise<void> {
  cupon.value = ''
  await carrito.quitarCupon().catch((fallo) => ui.errorDeApi(fallo))
}

// Si el cupón se cayó al recalcular, el campo vuelve a quedar libre.
watch(
  () => carrito.codigoCupon,
  (codigo) => {
    if (!codigo) cupon.value = ''
  },
)

async function confirmar(): Promise<void> {
  // El botón ya está apagado sin esto, pero un doble toque llega antes que
  // el repintado: la bandera se comprueba y se pone en el mismo tick.
  if (!puedeConfirmar.value) return
  confirmando.value = true
  try {
    const pedido = await carrito.confirmar(aceptaTerminos.value, direccion.value)
    pedidoHecho.value = pedido
    if (pedido.pago.metodo === 'TRANSFERENCIA' && pedido.pago.aPagar > 0) {
      // Si fallan, el pedido sigue hecho: la pantalla de éxito lo dice sin toast.
      await cargarBancarios()
    }
  } catch (fallo) {
    // El carrito NO se vacía: el cliente conserva lo que había armado.
    if (fallo instanceof ErrorApi) {
      ui.error(fallo.message)
      // El estado pudo cambiar bajo los pies: se repinta el desglose real.
      await carrito.recalcular().catch(() => {})
    } else {
      ui.errorDeApi(fallo)
    }
  } finally {
    confirmando.value = false
  }
}
</script>

<template>
  <!-- Pantalla de éxito: folio, total y cashback generado. -->
  <div v-if="pedidoHecho" class="exito">
    <div class="exito-ico">🎉</div>
    <h2 class="exito-titulo">¡Pedido confirmado!</h2>
    <p class="exito-folio">{{ pedidoHecho.folio }}</p>

    <div class="res-card">
      <p class="res-subtitulo">Desglose de costos</p>
      <div class="res-filas">
        <div class="cart-summary-row">
          <span>Productos</span><span>{{ dinero(pedidoHecho.subtotal) }}</span>
        </div>
        <div class="cart-summary-row">
          <span>{{ pedidoHecho.metodoEntrega === 'TIENDA' ? 'Recoger en tienda' : 'Envío' }}</span>
          <span>{{ pedidoHecho.envio === 0 ? 'Gratis' : dinero(pedidoHecho.envio) }}</span>
        </div>
        <div v-if="pedidoHecho.recargoFuera > 0" class="cart-summary-row">
          <span>Recargo fuera de horario</span><span>{{ dinero(pedidoHecho.recargoFuera) }}</span>
        </div>
        <div v-if="pedidoHecho.descuento > 0" class="cart-summary-row descuento">
          <span>{{ pedidoHecho.cupon ? `Cupón ${pedidoHecho.cupon.code}` : 'Descuento' }}</span>
          <span>−{{ dinero(pedidoHecho.descuento) }}</span>
        </div>
      </div>
      <div class="cart-summary-row total">
        <span>Total</span><span>{{ dinero(pedidoHecho.total) }}</span>
      </div>
      <div v-if="pedidoHecho.pago.billetera > 0" class="res-filas">
        <div class="cart-summary-row descuento">
          <span>Pagado con billetera</span><span>−{{ dinero(pedidoHecho.pago.billetera) }}</span>
        </div>
        <div class="cart-summary-row a-pagar">
          <span>Por pagar</span><span>{{ dinero(pedidoHecho.pago.aPagar) }}</span>
        </div>
      </div>
    </div>

    <!-- Cómo se cobra lo que queda. -->
    <div v-if="pedidoHecho.pago.aPagar === 0" class="exito-pago">
      <p class="exito-pago-titulo">Pagado con tu billetera ✓</p>
    </div>
    <div v-else-if="pedidoHecho.pago.metodo === 'EFECTIVO'" class="exito-pago">
      <p class="exito-pago-titulo">💵 Pagas en efectivo al recibir</p>
      <p v-if="pedidoHecho.pago.pagoCon !== null" class="exito-pago-linea">
        Con {{ dinero(pedidoHecho.pago.pagoCon) }} · tu cambio:
        <strong>{{ dinero(pedidoHecho.pago.cambio ?? 0) }}</strong>
      </p>
    </div>
    <div v-else class="exito-pago transferencia">
      <p class="exito-pago-titulo">
        🏦 Transferencia · <span class="pendiente">Pago pendiente</span>
      </p>
      <dl v-if="bancarios && hayBancarios" class="datos-banco">
        <div>
          <dt>Banco</dt>
          <dd>{{ bancarios.banco ?? '—' }}</dd>
        </div>
        <div>
          <dt>Beneficiario</dt>
          <dd>{{ bancarios.beneficiario ?? '—' }}</dd>
        </div>
        <div v-if="bancarios.numeroCuenta">
          <dt>Cuenta</dt>
          <dd class="dato-fuerte">{{ bancarios.numeroCuenta }}</dd>
        </div>
        <div v-if="bancarios.numeroTarjeta">
          <dt>Tarjeta</dt>
          <dd class="dato-copiable">
            <span class="dato-fuerte">{{ bancarios.numeroTarjeta }}</span>
            <button
              type="button"
              class="boton-copiar"
              aria-label="Copiar número de tarjeta"
              @click="copiar(bancarios.numeroTarjeta, 'Tarjeta')"
            >
              Copiar
            </button>
          </dd>
        </div>
        <div v-if="bancarios.clabe">
          <dt>CLABE</dt>
          <dd class="dato-copiable">
            <span class="dato-fuerte">{{ bancarios.clabe }}</span>
            <button
              type="button"
              class="boton-copiar"
              aria-label="Copiar CLABE"
              @click="copiar(bancarios.clabe, 'CLABE')"
            >
              Copiar
            </button>
          </dd>
        </div>
        <div>
          <dt>Monto</dt>
          <dd class="dato-fuerte">{{ dinero(pedidoHecho.pago.aPagar) }}</dd>
        </div>
        <div>
          <dt>Referencia</dt>
          <dd class="dato-fuerte">{{ pedidoHecho.pago.referencia }}</dd>
        </div>
      </dl>
      <p v-else class="exito-pago-linea">
        No pudimos mostrar los datos bancarios. Escríbenos y usa
        <strong>{{ pedidoHecho.pago.referencia }}</strong> como referencia.
      </p>
      <p class="exito-pago-nota">
        Tu pedido queda en <strong>Pago pendiente</strong> hasta que validemos la transferencia.
      </p>
    </div>

    <p v-if="pedidoHecho.cashbackGenerado > 0" class="exito-cashback">
      Ganaste {{ dinero(pedidoHecho.cashbackGenerado) }} de cashback
    </p>

    <div class="exito-acciones">
      <RouterLink to="/perfil/pedidos" class="btn-primary ancho">Ver mis pedidos</RouterLink>
      <RouterLink to="/" class="btn-cancel ancho">Volver al inicio</RouterLink>
    </div>
  </div>

  <div v-else-if="carrito.vacio" class="empty-block">
    <p>Tu carrito está vacío.</p>
    <RouterLink to="/tienda" class="btn-primary ancho volver">Ir a la tienda</RouterLink>
  </div>

  <div v-else class="carrito sin-colchon">
    <!-- Avisos de la API: fuera de horario, producto agotado… -->
    <div v-if="previsualizacion && previsualizacion.avisos.length > 0" class="avisos">
      <p v-for="(aviso, i) in previsualizacion.avisos" :key="i" class="aviso">
        {{ aviso }}
      </p>
    </div>

    <div class="lista">
      <article
        v-for="item in previsualizacion?.items ?? []"
        :key="item.productoId"
        class="cart-item-row"
        :class="{ 'is-agotado': item.agotado }"
      >
        <div class="media">🛒</div>
        <div class="info">
          <p class="nm">{{ item.nombre }}</p>
          <p class="pr">
            <span class="precio">{{ dinero(item.precioUnitario) }}</span> ·
            {{ item.unidad }}
            <span v-if="item.agotado" class="etiqueta-agotado">Agotado</span>
          </p>
        </div>
        <div class="qty-control">
          <button type="button" aria-label="Quitar uno" @click="carrito.quitar(item.productoId)">
            −
          </button>
          <span class="qn">{{ item.cantidad }}</span>
          <button
            type="button"
            :disabled="item.agotado"
            aria-label="Añadir uno"
            @click="carrito.agregar(item.productoId)"
          >
            +
          </button>
        </div>
      </article>

      <div v-if="!previsualizacion && carrito.calculando" class="cargando-lista">Calculando…</div>
    </div>

    <!--
      Resumen: desglose, envío, pago y cashback en UNA tarjeta. Las secciones
      se separan con subtítulos en mayúsculas y divisores finos, no con cajas.
    -->
    <div v-if="previsualizacion" class="res-card">
      <h2 class="res-titulo">Resumen del pedido</h2>

      <!-- Desglose. Cada línea viene de la API tal cual. Solo él se atenúa al recalcular. -->
      <div class="desglose" :class="{ recalculando: carrito.calculando }">
        <p class="res-subtitulo">Desglose de costos</p>
        <div class="res-filas">
          <div class="cart-summary-row">
            <span>Productos</span><span>{{ dinero(previsualizacion.subtotal) }}</span>
          </div>
          <div class="cart-summary-row">
            <span>Envío</span>
            <span>{{
              previsualizacion.envio === 0 ? 'Gratis' : dinero(previsualizacion.envio)
            }}</span>
          </div>
          <div v-if="previsualizacion.recargoFuera > 0" class="cart-summary-row">
            <span>Recargo fuera de horario</span>
            <span>{{ dinero(previsualizacion.recargoFuera) }}</span>
          </div>
          <div v-if="previsualizacion.descuento > 0" class="cart-summary-row descuento">
            <span>{{
              previsualizacion.cupon ? `Cupón ${previsualizacion.cupon.codigo}` : 'Descuento'
            }}</span>
            <span>−{{ dinero(previsualizacion.descuento) }}</span>
          </div>
        </div>
        <div class="cart-summary-row total">
          <span>Total</span><span>{{ dinero(previsualizacion.total) }}</span>
        </div>
        <!-- La billetera no rebaja el pedido: paga parte de él. Por eso va tras el total. -->
        <div v-if="previsualizacion.billetera > 0" class="res-filas">
          <div class="cart-summary-row descuento">
            <span>Billetera</span><span>−{{ dinero(previsualizacion.billetera) }}</span>
          </div>
          <div class="cart-summary-row a-pagar">
            <span>Total a pagar</span><span>{{ dinero(previsualizacion.aPagar) }}</span>
          </div>
        </div>
      </div>

      <!-- Entrega: recoger en tienda no paga envío; el total nuevo lo trae la API. -->
      <fieldset class="entrega res-seccion">
        <legend class="res-subtitulo">Método de envío</legend>
        <label v-for="e in ENTREGAS" :key="e.valor" class="entrega-opcion">
          <input
            type="radio"
            name="metodo-entrega"
            :value="e.valor"
            :checked="carrito.metodoEntrega === e.valor"
            @change="elegirEntrega(e.valor)"
          />
          <span>{{ e.titulo }}</span>
        </label>
      </fieldset>

      <!--
        Dirección de este pedido (HU-01): solo a domicilio. Al volver a tienda
        se oculta, pero lo capturado sigue en el borrador del carrito.
      -->
      <div v-if="aDomicilio" class="res-seccion">
        <BloqueDireccionEntrega
          v-if="direccion"
          ref="bloqueDireccion"
          :model-value="direccion"
          :perfil="perfil"
          :marcar-errores="marcarErroresDireccion"
          @update:model-value="cambiarDireccion"
          @perfil-guardado="perfil = $event"
        />
        <p v-else class="cargando-direccion">Cargando tu dirección…</p>
      </div>

      <!-- Lo que le falta al pedido (HU-20): se dice aquí, no en la Tienda. -->
      <div
        v-if="
          (previsualizacion.cashbackEstimado === 0 && previsualizacion.metas?.faltaCashback) ||
          previsualizacion.metas?.faltaEnvioGratis
        "
        class="metas"
      >
        <p
          v-if="previsualizacion.cashbackEstimado === 0 && previsualizacion.metas?.faltaCashback"
          class="meta"
        >
          ¡Estás a solo {{ dinero(previsualizacion.metas.faltaCashback) }} de activar tu cashback!
        </p>
        <p v-if="previsualizacion.metas?.faltaEnvioGratis" class="meta">
          Te faltan {{ dinero(previsualizacion.metas.faltaEnvioGratis) }} para envío gratis
        </p>
      </div>

      <!--
      Método de pago (HU-09 a HU-12). Va DEBAJO del total: primero el
      cliente ve lo que cuesta y luego decide cómo pagarlo. Cada monto
      (cambio, tope de la billetera, descuento) lo calcula la API; aquí
      solo se recogen las elecciones y se pinta su respuesta.
    -->
      <section v-if="pago" class="seccion-pago res-seccion" aria-labelledby="titulo-pago">
        <h3 id="titulo-pago" class="res-subtitulo">Método de pago</h3>

        <!-- Cupón (HU-10): uno por pedido. El motivo del rechazo, bajo el campo. -->
        <div class="bloque">
          <label class="form-label" for="cupon">¿Tienes un cupón?</label>
          <div v-if="previsualizacion.cupon" class="chip-cupon">
            <span class="chip-codigo">{{ previsualizacion.cupon.codigo }}</span>
            <span class="chip-texto">
              {{ previsualizacion.cupon.descripcion }} · −{{ dinero(previsualizacion.descuento) }}
            </span>
            <button
              type="button"
              class="chip-quitar"
              :aria-label="`Quitar el cupón ${previsualizacion.cupon.codigo}`"
              @click="quitarCupon"
            >
              ×
            </button>
          </div>
          <template v-else>
            <div class="fila-cupon">
              <input
                id="cupon"
                v-model="cupon"
                class="form-input campo-16"
                :class="{ 'is-invalid': carrito.errorCupon }"
                placeholder="Escribe tu código"
                autocomplete="off"
                autocapitalize="characters"
                @keyup.enter="cupon.trim() && aplicarCupon()"
              />
              <button
                type="button"
                class="btn-secondary boton-cupon"
                :disabled="aplicandoCupon || !cupon.trim()"
                @click="aplicarCupon"
              >
                {{ aplicandoCupon ? '…' : 'Aplicar' }}
              </button>
            </div>
            <p v-if="carrito.errorCupon" class="form-error">
              {{ carrito.errorCupon }}
            </p>
          </template>
        </div>

        <!-- Billetera (HU-12): solo con saldo. Se combina con cualquier método. -->
        <div v-if="pago.saldoBilletera > 0" class="bloque">
          <label class="opcion-check">
            <input v-model="usaBilletera" type="checkbox" @change="alternarBilletera" />
            <span>
              Usar mi billetera
              <span class="saldo">Disponible: {{ dinero(pago.saldoBilletera) }}</span>
            </span>
          </label>
          <template v-if="usaBilletera">
            <label class="form-label sub" for="monto-billetera">¿Cuánto quieres usar?</label>
            <input
              id="monto-billetera"
              v-model="billeteraTexto"
              class="form-input campo-16"
              :class="{ 'is-invalid': pago.errorBilletera }"
              inputmode="decimal"
              placeholder="$0.00"
            />
            <p v-if="pago.errorBilletera" class="form-error">
              {{ pago.errorBilletera.mensaje }}
            </p>
          </template>
        </div>

        <p v-if="cubiertoConBilletera" class="nota-cubierto">
          Tu billetera cubre el total del pedido: no tienes que pagar nada más.
        </p>

        <!-- Cómo se paga lo que queda. -->
        <div v-else class="bloque">
          <p class="form-label">¿Cómo vas a pagar?</p>
          <!-- Uno debajo del otro; el detalle de cada método se abre bajo su opción. -->
          <div class="metodos" role="radiogroup" aria-label="Método de pago">
            <template v-for="m in METODOS" :key="m.valor">
              <label class="metodo" :class="{ activo: carrito.metodoPago === m.valor }">
                <input
                  type="radio"
                  name="metodo-pago"
                  :value="m.valor"
                  :checked="carrito.metodoPago === m.valor"
                  @change="elegirMetodo(m.valor)"
                />
                <span class="metodo-titulo">{{ m.titulo }}</span>
                <span class="metodo-detalle">{{ m.detalle }}</span>
              </label>

              <!-- Efectivo (HU-09): con cuánto paga, para que el repartidor lleve cambio. -->
              <div
                v-if="m.valor === 'EFECTIVO' && carrito.metodoPago === 'EFECTIVO'"
                class="detalle-metodo"
              >
                <label class="form-label" for="pago-con">¿Con cuánto vas a pagar?</label>
                <input
                  id="pago-con"
                  v-model="pagoConTexto"
                  class="form-input campo-16"
                  :class="{
                    'is-invalid': pago.errorPago?.codigo === 'PAGO_INSUFICIENTE',
                  }"
                  inputmode="decimal"
                  :placeholder="dinero(previsualizacion.aPagar)"
                />
                <p v-if="pago.errorPago?.codigo === 'PAGO_INSUFICIENTE'" class="form-error">
                  {{ pago.errorPago.mensaje }}
                </p>
                <p v-else-if="pago.cambio !== null && !montoPendiente" class="cambio">
                  Tu cambio: <strong>{{ dinero(pago.cambio) }}</strong>
                </p>
              </div>

              <!--
              Transferencia (HU-11): los datos del negocio se ven antes de
              confirmar; la referencia es el folio, que solo existe después.
            -->
              <div
                v-else-if="m.valor === 'TRANSFERENCIA' && carrito.metodoPago === 'TRANSFERENCIA'"
                class="detalle-metodo"
              >
                <p v-if="cargandoBancarios" class="nota">Cargando datos bancarios…</p>
                <dl v-else-if="bancarios && hayBancarios" class="datos-banco">
                  <div v-if="bancarios.banco">
                    <dt>Banco</dt>
                    <dd>{{ bancarios.banco }}</dd>
                  </div>
                  <div v-if="bancarios.beneficiario">
                    <dt>Beneficiario</dt>
                    <dd>{{ bancarios.beneficiario }}</dd>
                  </div>
                  <div v-if="bancarios.numeroCuenta">
                    <dt>Cuenta</dt>
                    <dd class="dato-fuerte">{{ bancarios.numeroCuenta }}</dd>
                  </div>
                  <div v-if="bancarios.numeroTarjeta">
                    <dt>Tarjeta</dt>
                    <dd class="dato-copiable">
                      <span class="dato-fuerte">{{ bancarios.numeroTarjeta }}</span>
                      <button
                        type="button"
                        class="boton-copiar"
                        aria-label="Copiar número de tarjeta"
                        @click="copiar(bancarios.numeroTarjeta, 'Tarjeta')"
                      >
                        Copiar
                      </button>
                    </dd>
                  </div>
                  <div v-if="bancarios.clabe">
                    <dt>CLABE</dt>
                    <dd class="dato-copiable">
                      <span class="dato-fuerte">{{ bancarios.clabe }}</span>
                      <button
                        type="button"
                        class="boton-copiar"
                        aria-label="Copiar CLABE"
                        @click="copiar(bancarios.clabe, 'CLABE')"
                      >
                        Copiar
                      </button>
                    </dd>
                  </div>
                </dl>
                <p v-else-if="bancarios" class="nota">
                  El negocio aún no registra sus datos bancarios. Escríbenos para pagar por
                  transferencia.
                </p>
                <p v-else class="nota">
                  No pudimos cargar los datos bancarios; te los mostramos al confirmar.
                </p>
                <p class="nota">
                  Usa el folio de tu pedido como referencia: te lo damos al confirmar. Queda en
                  <strong>Pago pendiente</strong> hasta que validemos la transferencia.
                </p>
              </div>
            </template>
          </div>
        </div>
      </section>

      <!-- Cashback (HU-13): lo que se acredita es la base por el multiplicador. -->
      <div v-if="previsualizacion.cashbackEstimado > 0" class="bloque-cashback res-seccion">
        <span class="cashback-ico" aria-hidden="true">🎁</span>
        <p>
          Ganarás
          <strong>{{ dinero(previsualizacion.cashbackEstimado) }}</strong> de cashback, que valen
          <strong>{{ dinero(previsualizacion.cashbackBilletera) }}</strong> en tu billetera.
        </p>
      </div>
    </div>

    <!-- Términos y confirmación (HU-14). -->
    <label v-if="previsualizacion" class="opcion-check terminos">
      <input v-model="aceptaTerminos" type="checkbox" />
      <span>
        Acepto el
        <RouterLink to="/legal/privacidad" target="_blank">aviso de privacidad</RouterLink>
        y los
        <RouterLink to="/legal/terminos" target="_blank">términos y condiciones</RouterLink>.
      </span>
    </label>

    <div class="confirmar-wrap">
      <button
        type="button"
        class="btn-primary ancho"
        :disabled="!puedeConfirmar"
        @click="confirmar"
      >
        {{ confirmando ? 'Confirmando…' : 'Confirmar pedido' }}
      </button>
      <button
        v-if="motivoDireccion && direccion"
        type="button"
        class="motivo-bloqueo motivo-enlace"
        @click="revisarDireccion"
      >
        {{ motivoDireccion }}
      </button>
      <p v-else-if="motivoBloqueo || motivoDireccion || motivoPago" class="motivo-bloqueo">
        {{ motivoBloqueo || motivoDireccion || motivoPago }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.carrito,
.exito {
  padding: 12px 18px 0;
}

.avisos {
  background: linear-gradient(135deg, #fff3e0, #ffe0b2);
  border: 1.5px solid var(--gold-dark);
  border-radius: 14px;
  padding: 12px 14px;
  margin-bottom: 14px;
}

.aviso {
  font-size: 12px;
  color: var(--ink);
  line-height: 1.45;
  margin: 0 0 6px;
}

.aviso:last-child {
  margin-bottom: 0;
}

.cart-item-row {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--white);
  border-radius: 14px;
  padding: 10px 12px;
  margin-bottom: 10px;
  box-shadow: var(--shadow);
}

.cart-item-row.is-agotado {
  opacity: 0.7;
}

.cart-item-row .media {
  width: 46px;
  height: 46px;
  border-radius: 10px;
  background: var(--cream-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
}

.cart-item-row .info {
  flex: 1;
  min-width: 0;
}

.cart-item-row .info .nm {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  color: var(--ink);
  margin: 0;
}

.cart-item-row .info .pr {
  font-size: 11px;
  color: var(--muted);
  margin: 2px 0 0;
}

.cart-item-row .info .precio {
  color: var(--verde-dark);
  font-weight: 700;
}

.etiqueta-agotado {
  color: var(--terracotta);
  font-weight: 700;
  margin-left: 6px;
}

.qty-control {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}

.qty-control button {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 1.5px solid var(--line);
  background: var(--cream);
  font-weight: 800;
  font-size: 14px;
  cursor: pointer;
  color: var(--ink);
}

.qty-control button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.qty-control .qn {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  min-width: 16px;
  text-align: center;
}

.cargando-lista {
  text-align: center;
  color: var(--muted);
  font-size: 12.5px;
  padding: 18px 0;
}

/* ---- Método de pago ---- */

.bloque {
  margin-bottom: 10px;
}

/* Compacto: la sección entera debe caber sin tanto desplazamiento. */
.seccion-pago .form-label {
  font-size: 12px;
  margin-bottom: 5px;
}

.fila-cupon .form-input {
  height: 40px;
  padding-block: 0;
}

/*
 * El texto escrito se queda en 16px (zoom de Safari), pero el placeholder
 * baja al tamaño del resto de la tarjeta y sin mayúsculas, que lo agrandaban.
 */
.fila-cupon .form-input::placeholder {
  font-size: 13.5px;
  text-transform: none;
}

.bloque:last-child {
  margin-bottom: 0;
}

.form-label.sub {
  margin-top: 10px;
}

/* 16px o más: por debajo, Safari en iPhone hace zoom al enfocar el campo. */
.campo-16 {
  font-size: 16px;
}

.chip-cupon {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--cream);
  border: 1.5px dashed var(--sage);
  border-radius: 12px;
  padding: 8px 8px 8px 10px;
}

.chip-codigo {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 12.5px;
  letter-spacing: 0.05em;
  color: var(--white);
  background: var(--sage);
  border-radius: 8px;
  padding: 3px 8px;
  flex-shrink: 0;
}

.chip-texto {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
}

.chip-quitar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1.5px solid var(--line);
  background: var(--white);
  color: var(--muted);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}

.opcion-check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
}

.opcion-check input {
  width: 20px;
  height: 20px;
  margin: 0;
  accent-color: var(--verde);
  flex-shrink: 0;
}

.saldo {
  display: block;
  font-weight: 600;
  font-size: 11.5px;
  color: var(--sage);
  margin-top: 2px;
}

.nota-cubierto {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  color: var(--sage);
  margin: 0;
}

/*
 * Una opción por renglón, radio a la izquierda y detalle a la derecha: filas
 * de la tabla del resumen, no cajas. El detalle abierto se sangra bajo el radio.
 */
.metodo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--divisor);
  cursor: pointer;
}

.metodo input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--verde-dark);
  flex-shrink: 0;
}

/* Con su detalle abierto, la línea pasa al final del detalle. */
.metodo.activo {
  border-bottom: none;
}

.metodo-titulo {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  color: var(--ink);
}

.metodo.activo .metodo-titulo {
  font-weight: 700;
  color: var(--verde-dark);
}

.metodo-detalle {
  font-size: 11px;
  color: var(--muted);
  flex-shrink: 0;
}

.detalle-metodo {
  padding: 0 0 10px 28px;
  border-bottom: 1px solid var(--divisor);
}

.metodos > :last-child {
  border-bottom: none;
}

.detalle-metodo .nota {
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted);
  margin: 8px 0 0;
}

.dato-copiable {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.boton-copiar {
  flex-shrink: 0;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11px;
  color: var(--verde-dark);
  background: var(--white);
  border: 1.5px solid var(--verde-dark);
  border-radius: 999px;
  padding: 3px 10px;
  cursor: pointer;
}

/* ---- Método de envío ---- */

.entrega {
  border: none;
  padding: 0;
  min-width: 0;
}

.entrega legend {
  padding: 0;
}

.entrega-opcion {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13.5px;
  color: var(--ink);
  padding: 7px 0;
  border-bottom: 1px solid var(--divisor);
  cursor: pointer;
}

.entrega-opcion:last-of-type {
  border-bottom: none;
}

.entrega-opcion:has(input:checked) span {
  font-weight: 700;
  color: var(--verde-dark);
}

.entrega-opcion input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--verde-dark);
}

.cambio {
  font-family: var(--font-heading);
  font-size: 13px;
  color: var(--sage);
  margin: -4px 0 0;
}

.bloque-cashback {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bloque-cashback p {
  font-size: 12px;
  line-height: 1.45;
  color: var(--ink);
  margin: 0;
}

.cashback-ico {
  font-size: 22px;
}

.terminos {
  font-weight: 600;
  font-size: 12px;
  line-height: 1.5;
  margin: 2px 2px 8px;
}

.terminos a {
  color: var(--terracotta-dark);
  font-weight: 700;
}

.cart-summary-row.a-pagar {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 14px;
  color: var(--ink);
}

.fila-cupon {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.fila-cupon .form-input {
  flex: 1;
  min-width: 0;
  text-transform: uppercase;
}

.boton-cupon {
  flex-shrink: 0;
  height: 40px;
}

/*
 * ---- Resumen: una tarjeta que se lee como tabla sin serlo ----
 * Filas con los extremos alineados (los importes caen en la misma columna),
 * divisores de 1px casi invisibles y un solo acento verde fuerte: el total.
 */

.res-card {
  --divisor: color-mix(in srgb, var(--line) 55%, var(--white));
  background: var(--white);
  border: 1px solid var(--divisor);
  border-radius: 14px;
  padding: 14px;
  margin: 12px 0;
}

.res-titulo {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 1.125rem;
  color: var(--verde-dark);
  margin: 0 0 8px;
}

/* Las mayúsculas espaciadas separan secciones sin necesitar cajas. */
.res-subtitulo {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 4px;
}

.res-seccion {
  margin-top: 16px;
}

.desglose {
  transition: opacity 0.15s ease;
}

.desglose.recalculando {
  opacity: 0.55;
}

.cart-summary-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  font-size: 13px;
  color: var(--ink);
  padding: 6px 0;
  border-bottom: 1px solid var(--divisor);
}

/* Sin línea en el último renglón: no se ve una caja cerrada. */
.res-filas > .cart-summary-row:last-child {
  border-bottom: none;
}

.cart-summary-row.descuento {
  color: var(--verde-dark);
  font-weight: 700;
}

/* La única línea fuerte: marca el cierre de la cuenta. */
.cart-summary-row.total {
  font-family: var(--font-heading);
  font-weight: 900;
  font-size: 1.375rem;
  color: var(--verde-dark);
  border-top: 2px solid var(--verde);
  border-bottom: none;
  margin-top: 2px;
  padding: 8px 0 4px;
}

.metas {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}

/* Lo que falta es un empujón, no un logro: borde dorado, sin fondo dorado. */
.meta {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11.5px;
  color: var(--ink);
  text-align: center;
  background: var(--white);
  border: 1.5px solid var(--gold);
  border-radius: 999px;
  padding: 6px 12px;
  margin: 0;
}

/* Sin margen abajo: el botón cierra la pantalla (ver `.sin-colchon` en AppLayout). */
.confirmar-wrap {
  margin: 6px 0 0;
}

.ancho {
  width: 100%;
  display: block;
  text-decoration: none;
}

.motivo-bloqueo {
  font-size: 11.5px;
  color: var(--terracotta-dark);
  text-align: center;
  line-height: 1.45;
  margin: 10px 0 0;
}

.motivo-enlace {
  display: block;
  width: 100%;
  background: none;
  border: none;
  padding: 0;
  font-family: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.cargando-direccion {
  font-size: 12.5px;
  color: var(--muted);
  margin: 0;
}

.volver {
  margin-top: 16px;
  max-width: 220px;
  margin-inline: auto;
}

/* ---- Pantalla de éxito ---- */

.exito {
  text-align: center;
  padding-top: 40px;
}

.exito-ico {
  font-size: 52px;
  margin-bottom: 12px;
}

.exito-titulo {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 18px;
  color: var(--ink);
  margin: 0 0 4px;
}

.exito-folio {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 14px;
  color: var(--terracotta-dark);
  letter-spacing: 0.06em;
  margin: 0 0 18px;
}

.exito .cart-summary-row {
  text-align: left;
}

.exito-pago {
  text-align: left;
  background: var(--white);
  border-radius: 14px;
  box-shadow: var(--shadow);
  padding: 12px 14px;
  margin: 0 0 14px;
}

.exito-pago.transferencia {
  border: 1.5px solid var(--gold);
}

.exito-pago-titulo {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  color: var(--ink);
  margin: 0;
}

.pendiente {
  color: var(--gold-dark);
}

.exito-pago-linea,
.exito-pago-nota {
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink);
  margin: 8px 0 0;
}

.exito-pago-nota {
  color: var(--muted);
}

.datos-banco {
  margin: 10px 0 0;
}

.datos-banco div {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--divisor, var(--line));
  font-size: 12px;
}

.datos-banco > div:last-child {
  border-bottom: none;
}

.datos-banco dt {
  color: var(--muted);
}

.datos-banco dd {
  margin: 0;
  color: var(--ink);
  text-align: right;
  word-break: break-all;
}

.datos-banco .dato-fuerte {
  font-family: var(--font-heading);
  font-weight: 800;
  user-select: all;
}

.exito-cashback {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13px;
  color: var(--sage);
  margin: 0 0 18px;
}

.exito-acciones {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 24px;
}
</style>
