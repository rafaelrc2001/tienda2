<script setup lang="ts">
/**
 * PDV → Punto de Venta: la caja de un turno abierto, en tres pasos.
 *
 * Los pasos van en una fila de pestañas y solo se ve uno a la vez: abrir uno
 * esconde los otros dos, y se puede volver a cualquiera sin perder la orden.
 * Así la caja no crece hacia abajo ni obliga a desplazarse para cobrar. Cada
 * pestaña enseña en pequeño lo que ya lleva: quién es el cliente, cuántas
 * piezas y cuánto se va a cobrar.
 *
 *  1. **Teléfono del cliente**, con su teclado: es el mismo identificador con
 *     el que entra a la app. Desde el tercer dígito propone los teléfonos ya
 *     registrados que lo contienen; si no está registrado se le pide el nombre.
 *  2. **Tienda**: el catálogo, en el orden que ese cliente vería en la Tienda,
 *     con «repite tu última compra».
 *  3. **Pedido**: el resumen, cómo se lo lleva, cómo paga y los tres botones.
 *
 * Es el checkout de la app hecho por el cajero. Ningún importe se calcula
 * aquí: cada cambio de la orden se manda a previsualizar y se pinta lo que
 * responde la API. Las respuestas viejas se descartan por número de petición.
 *
 * «Confirmar pedido» lo crea; «Entregado» lo da por entregado y cobrado, y es
 * cuando la mercancía sale del inventario de la tienda. Un pedido a domicilio
 * se confirma aquí y sigue por Operaciones y Rutas.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero } from '@/utils/formato'
import type {
  CatalogoRecomendado,
  ClientePdv,
  MetodoEntrega,
  MetodoPago,
  Pedido,
  PrevisualizacionCarrito,
  ProductoRecomendado,
  TurnoPdv,
  UltimoPedido,
} from '@/api/tipos'

const props = defineProps<{ turno: TurnoPdv }>()
/** Se confirmó o se entregó un pedido: el turno tiene que releerse. */
const emit = defineEmits<{ cambio: [] }>()

const ui = useUiStore()

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
const DIGITOS_TELEFONO = 10
/** Lo que se espera tras el último cambio antes de pedir el desglose. */
const ESPERA_MS = 250

// ---- Pasos ----
type Paso = 'telefono' | 'tienda' | 'pedido'
/** El único paso a la vista. Los otros dos siguen montados, con lo que llevan. */
const paso = ref<Paso>('telefono')

// ---- Cliente ----
const telefono = ref('')
const cliente = ref<ClientePdv | null>(null)
const buscando = ref(false)
/** El teléfono no está registrado: falta su nombre para darlo de alta. */
const pidiendoNombre = ref(false)
const nombreNuevo = ref('')
const errorCliente = ref('')
/** Registrados cuyo teléfono contiene lo tecleado. Se toca uno y se atiende. */
const sugerencias = ref<ClientePdv[]>([])
/** A partir de cuántos dígitos se propone: con menos, casi todos coinciden. */
const DIGITOS_PARA_SUGERIR = 3

// ---- Catálogo ----
const catalogo = ref<CatalogoRecomendado | null>(null)
const familia = ref('')
const ultimo = ref<UltimoPedido | null>(null)

// ---- Orden ----
/** `productoId` → piezas. Solo esto y el pago viajan a la API: nunca precios. */
const cantidades = ref<Record<string, number>>({})
const metodoEntrega = ref<MetodoEntrega>('TIENDA')
const metodoPago = ref<MetodoPago>('EFECTIVO')
const pagoCon = ref('')
const usarBilletera = ref(false)
const previa = ref<PrevisualizacionCarrito | null>(null)
const calculando = ref(false)

// ---- Pedido ya confirmado ----
const pedido = ref<Pedido | null>(null)
const confirmando = ref(false)
const entregando = ref(false)
const errorOrden = ref('')

const items = computed(() =>
  Object.entries(cantidades.value)
    .filter(([, cantidad]) => cantidad > 0)
    .map(([productoId, cantidad]) => ({ productoId, cantidad })),
)

/** Piezas en la orden. Es un conteo para la pestaña, no un importe. */
const piezas = computed(() => items.value.reduce((suma, i) => suma + i.cantidad, 0))

/** Las tres pestañas, con lo que cada una ya lleva resuelto. */
const pasos = computed<{ id: Paso; titulo: string; resumen: string }[]>(() => [
  { id: 'telefono', titulo: 'Teléfono', resumen: cliente.value?.nombre ?? 'Sin cliente' },
  {
    id: 'tienda',
    titulo: 'Tienda',
    resumen:
      piezas.value === 0
        ? 'Sin productos'
        : `${piezas.value} pieza${piezas.value === 1 ? '' : 's'}`,
  },
  {
    id: 'pedido',
    titulo: 'Pedido',
    resumen: pedido.value?.folio ?? (previa.value ? dinero(previa.value.aPagar) : 'Sin total'),
  },
])

/** Sin cliente no hay catálogo ni pedido que abrir: primero el teléfono. */
function abrir(destino: Paso): void {
  if (destino !== 'telefono' && !cliente.value) return
  paso.value = destino
}

const productos = computed<ProductoRecomendado[]>(
  () => catalogo.value?.familias.find((f) => f.categoria === familia.value)?.productos ?? [],
)

/** La orden deja de editarse en cuanto hay pedido: lo confirmado ya tiene folio. */
const bloqueada = computed(() => pedido.value !== null)

const puedeConfirmar = computed(
  () =>
    cliente.value !== null &&
    !bloqueada.value &&
    !confirmando.value &&
    !calculando.value &&
    items.value.length > 0 &&
    previa.value !== null &&
    previa.value.puedePedir &&
    previa.value.pago.errorPago === null,
)

const puedeEntregar = computed(
  () => pedido.value !== null && pedido.value.metodoEntrega === 'TIENDA' && !entregando.value,
)

/** Precio por pieza de un producto: el de su línea ya valorada, o el de venta. */
function precioDe(producto: ProductoRecomendado): number {
  return (
    previa.value?.items.find((i) => i.productoId === producto.id)?.precioUnitario ??
    producto.precioVenta
  )
}

// ----------------------------------------------------------------
// Cliente
// ----------------------------------------------------------------

function teclear(digito: string): void {
  if (cliente.value || telefono.value.length >= DIGITOS_TELEFONO) return
  telefono.value += digito
}

function borrar(): void {
  if (cliente.value) return
  telefono.value = telefono.value.slice(0, -1)
}

let peticionSugerencias = 0
let esperaSugerencias: ReturnType<typeof setTimeout> | undefined

/**
 * Se piden con una pausa, no en cada tecla, y las respuestas viejas se
 * descartan: la lista siempre es la del teléfono que está en el visor.
 */
watch(telefono, (escrito) => {
  const numero = ++peticionSugerencias
  clearTimeout(esperaSugerencias)
  if (cliente.value || escrito.length < DIGITOS_PARA_SUGERIR) {
    sugerencias.value = []
    return
  }
  esperaSugerencias = setTimeout(async () => {
    try {
      const encontrados = await http.get<ClientePdv[]>(
        `/admin/pdv/clientes/sugerencias?telefono=${escrito}`,
      )
      if (numero === peticionSugerencias) sugerencias.value = encontrados
    } catch {
      // Es una ayuda: si falla, el cajero termina de teclear e ingresa como siempre.
      if (numero === peticionSugerencias) sugerencias.value = []
    }
  }, ESPERA_MS)
})

/** Los últimos 10 dígitos: como se teclea en el mostrador, sin la lada con que se guardó. */
function telefonoLocal(guardado: string): string {
  return guardado.replace(/\D/g, '').slice(-DIGITOS_TELEFONO)
}

async function elegir(sugerido: ClientePdv): Promise<void> {
  errorCliente.value = ''
  telefono.value = telefonoLocal(sugerido.telefono)
  buscando.value = true
  try {
    await atender(sugerido)
  } catch (fallo) {
    cliente.value = null
    errorCliente.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos cargar al cliente.'
  } finally {
    buscando.value = false
  }
}

function alEscribirTelefono(evento: Event): void {
  const entrada = evento.target as HTMLInputElement
  telefono.value = entrada.value.replace(/\D/g, '').slice(0, DIGITOS_TELEFONO)
  entrada.value = telefono.value
}

async function ingresar(): Promise<void> {
  errorCliente.value = ''
  if (telefono.value.length !== DIGITOS_TELEFONO) {
    errorCliente.value = 'El teléfono debe tener 10 dígitos.'
    return
  }
  buscando.value = true
  try {
    const encontrado = await http.get<ClientePdv | null>(
      `/admin/pdv/clientes?telefono=${telefono.value}`,
    )
    if (encontrado) await atender(encontrado)
    else pidiendoNombre.value = true
  } catch (fallo) {
    errorCliente.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos buscar al cliente.'
  } finally {
    buscando.value = false
  }
}

async function registrar(): Promise<void> {
  errorCliente.value = ''
  if (nombreNuevo.value.trim().length < 2) {
    errorCliente.value = 'Escribe el nombre del cliente.'
    return
  }
  buscando.value = true
  try {
    await atender(
      await http.post<ClientePdv>('/admin/pdv/clientes', {
        telefono: telefono.value,
        nombre: nombreNuevo.value.trim(),
      }),
    )
  } catch (fallo) {
    errorCliente.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos registrarlo.'
  } finally {
    buscando.value = false
  }
}

/** Con el cliente identificado se carga su catálogo y su última compra. */
async function atender(encontrado: ClientePdv): Promise<void> {
  cliente.value = encontrado
  pidiendoNombre.value = false
  peticionSugerencias++
  clearTimeout(esperaSugerencias)
  sugerencias.value = []
  const [suCatalogo, suUltimo] = await Promise.all([
    http.get<CatalogoRecomendado>(`/admin/pdv/clientes/${encontrado.id}/catalogo`),
    http.get<UltimoPedido | null>(`/admin/pdv/clientes/${encontrado.id}/ultimo-pedido`),
  ])
  catalogo.value = suCatalogo
  familia.value = suCatalogo.familias[0]?.categoria ?? ''
  ultimo.value = suUltimo
  // Identificado el cliente, lo siguiente es elegir qué se lleva.
  paso.value = 'tienda'
}

// ----------------------------------------------------------------
// Orden
// ----------------------------------------------------------------

function fijar(productoId: string, cantidad: number): void {
  if (bloqueada.value) return
  if (cantidad > 0) {
    cantidades.value = { ...cantidades.value, [productoId]: cantidad }
    return
  }
  const { [productoId]: _fuera, ...resto } = cantidades.value
  cantidades.value = resto
}

function sumar(productoId: string, delta: number): void {
  fijar(productoId, (cantidades.value[productoId] ?? 0) + delta)
}

/** «Sí, usar este pedido»: la orden pasa a ser lo disponible de su última compra. */
function repetirUltimo(): void {
  if (!ultimo.value || bloqueada.value) return
  cantidades.value = Object.fromEntries(
    ultimo.value.items.filter((i) => i.disponible).map((i) => [i.productoId, i.cantidad]),
  )
  ultimo.value = null
}

let peticion = 0
let temporizador: ReturnType<typeof setTimeout> | undefined

async function previsualizar(): Promise<void> {
  const numero = ++peticion
  if (!cliente.value || items.value.length === 0) {
    previa.value = null
    calculando.value = false
    return
  }
  try {
    const respuesta = await http.post<PrevisualizacionCarrito>(
      `/admin/pdv/turnos/${props.turno.id}/previsualizar`,
      {
        clienteId: cliente.value.id,
        items: items.value,
        metodoEntrega: metodoEntrega.value,
        metodoPago: metodoPago.value,
        ...(metodoPago.value === 'EFECTIVO' && pagoCon.value && { pagoCon: Number(pagoCon.value) }),
        // Se pide todo el saldo: la API aplica lo que cabe en el total.
        ...(usarBilletera.value && { usarBilletera: cliente.value.saldoBilletera }),
      },
    )
    // Otra petición salió después: esta ya no describe la orden en pantalla.
    if (numero !== peticion) return
    previa.value = respuesta
    errorOrden.value = ''
  } catch (fallo) {
    if (numero !== peticion) return
    errorOrden.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos calcular la orden.'
  } finally {
    if (numero === peticion) calculando.value = false
  }
}

watch(
  [items, metodoEntrega, metodoPago, pagoCon, usarBilletera, cliente],
  () => {
    if (bloqueada.value) return
    calculando.value = items.value.length > 0 && cliente.value !== null
    clearTimeout(temporizador)
    temporizador = setTimeout(() => void previsualizar(), ESPERA_MS)
  },
  { deep: true },
)

onBeforeUnmount(() => {
  clearTimeout(temporizador)
  clearTimeout(esperaSugerencias)
})

async function confirmar(): Promise<void> {
  if (!puedeConfirmar.value || !cliente.value || !previa.value) return
  confirmando.value = true
  errorOrden.value = ''
  try {
    pedido.value = await http.post<Pedido>(`/admin/pdv/turnos/${props.turno.id}/pedidos`, {
      clienteId: cliente.value.id,
      items: items.value,
      metodoEntrega: metodoEntrega.value,
      metodoPago: metodoPago.value,
      ...(metodoPago.value === 'EFECTIVO' && pagoCon.value && { pagoCon: Number(pagoCon.value) }),
      // Lo que la API dijo que cabía, no el saldo entero: de más, el pedido se rechaza.
      ...(previa.value.billetera > 0 && { usarBilletera: previa.value.billetera }),
    })
    ui.exito(`Pedido ${pedido.value.folio} confirmado`)
    emit('cambio')
  } catch (fallo) {
    errorOrden.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos confirmar el pedido.'
  } finally {
    confirmando.value = false
  }
}

async function entregar(): Promise<void> {
  if (!puedeEntregar.value || !pedido.value) return
  entregando.value = true
  errorOrden.value = ''
  try {
    const entregado = await http.post<Pedido>(`/admin/pdv/pedidos/${pedido.value.id}/entregar`)
    ui.exito(`Pedido ${entregado.folio} entregado y cobrado`)
    emit('cambio')
    limpiar()
  } catch (fallo) {
    errorOrden.value = fallo instanceof ErrorApi ? fallo.message : 'No pudimos entregar el pedido.'
  } finally {
    entregando.value = false
  }
}

/**
 * «Limpiar orden»: la caja queda lista para el siguiente cliente. Un pedido ya
 * confirmado no se borra con esto —sigue en la tabla del turno, de donde se
 * puede entregar—: aquí solo se suelta la pantalla.
 */
function limpiar(): void {
  peticion++
  clearTimeout(temporizador)
  telefono.value = ''
  cliente.value = null
  pidiendoNombre.value = false
  nombreNuevo.value = ''
  errorCliente.value = ''
  catalogo.value = null
  familia.value = ''
  ultimo.value = null
  cantidades.value = {}
  metodoEntrega.value = 'TIENDA'
  metodoPago.value = 'EFECTIVO'
  pagoCon.value = ''
  usarBilletera.value = false
  previa.value = null
  calculando.value = false
  pedido.value = null
  errorOrden.value = ''
  paso.value = 'telefono'
}
</script>

<template>
  <div class="caja">
    <div class="pasos" role="tablist" aria-label="Pasos de la orden">
      <button
        v-for="(p, i) in pasos"
        :key="p.id"
        type="button"
        role="tab"
        class="paso"
        :class="{ activo: paso === p.id }"
        :aria-selected="paso === p.id"
        :disabled="p.id !== 'telefono' && !cliente"
        @click="abrir(p.id)"
      >
        <span class="paso-numero">{{ i + 1 }}</span>
        <span class="paso-texto">
          <span class="paso-titulo">{{ p.titulo }}</span>
          <span class="paso-resumen">{{ p.resumen }}</span>
        </span>
      </button>
    </div>

    <!-- 1. Teléfono del cliente -->
    <section v-show="paso === 'telefono'" class="columna col-telefono">
      <label class="titulo-columna" for="pdv-telefono">Teléfono cliente</label>
      <input
        id="pdv-telefono"
        class="visor"
        inputmode="numeric"
        autocomplete="off"
        placeholder="Ej. 5512245678"
        :value="telefono"
        :disabled="cliente !== null"
        @input="alEscribirTelefono"
        @keydown.enter="ingresar"
      />

      <ul
        v-if="sugerencias.length > 0 && !cliente"
        class="sugerencias"
        aria-label="Clientes registrados"
      >
        <li v-for="s in sugerencias" :key="s.id">
          <button type="button" :disabled="buscando" @click="elegir(s)">
            <span class="s-telefono">{{ telefonoLocal(s.telefono) }}</span>
            <span class="s-nombre">{{ s.nombre }}</span>
          </button>
        </li>
      </ul>

      <div class="teclado">
        <button
          v-for="tecla in TECLAS"
          :key="tecla"
          type="button"
          class="tecla"
          :disabled="cliente !== null"
          @click="teclear(tecla)"
        >
          {{ tecla }}
        </button>
        <span />
        <button type="button" class="tecla" :disabled="cliente !== null" @click="teclear('0')">
          0
        </button>
        <button
          type="button"
          class="tecla"
          aria-label="Borrar"
          :disabled="cliente !== null"
          @click="borrar"
        >
          ⌫
        </button>
      </div>

      <div v-if="pidiendoNombre" class="zona-captura">
        <label class="form-label" for="pdv-nombre">Cliente nuevo: ¿cómo se llama?</label>
        <input
          id="pdv-nombre"
          v-model="nombreNuevo"
          class="form-input"
          placeholder="Nombre del cliente"
          @keydown.enter="registrar"
        />
      </div>

      <p v-if="errorCliente" class="form-error">{{ errorCliente }}</p>

      <button
        v-if="!cliente"
        type="button"
        class="btn-ingresar"
        :disabled="buscando"
        @click="pidiendoNombre ? registrar() : ingresar()"
      >
        {{ buscando ? 'Buscando…' : pidiendoNombre ? 'Registrar' : 'Ingresar' }}
      </button>

      <template v-else>
        <p class="atendiendo">
          Atendiendo a <strong>{{ cliente.nombre }}</strong>
        </p>
        <button type="button" class="btn-ingresar seguir" @click="abrir('tienda')">
          Ir a la tienda →
        </button>
        <button
          type="button"
          class="btn-ingresar"
          :disabled="confirmando || entregando"
          @click="limpiar"
        >
          Cambiar de cliente
        </button>
      </template>
    </section>

    <!-- 2. Cliente y catálogo -->
    <section v-show="paso === 'tienda'" class="columna col-catalogo">
      <template v-if="cliente">
        <div class="cabecera-cliente">
          <div class="cliente">
            <span class="titulo-columna">Cliente</span>
            <span class="nombre">{{ cliente.nombre }}</span>
            <span v-if="cliente.esNuevo" class="mini-tag">Primera compra</span>
          </div>

          <div v-if="ultimo && !bloqueada" class="ultima-compra">
            <p class="ultima-titulo">⚡ Repite tu última compra, en un solo click</p>
            <table class="tabla-lineas">
              <tbody>
                <tr
                  v-for="i in ultimo.items"
                  :key="i.productoId"
                  :class="{ agotada: !i.disponible }"
                >
                  <td>{{ i.cantidad }}× {{ i.nombre }}</td>
                  <td class="num">{{ i.disponible ? dinero(i.importe) : 'Agotado' }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="fuerte">
                  <td>Total productos</td>
                  <td class="num">{{ dinero(ultimo.subtotal) }}</td>
                </tr>
              </tfoot>
            </table>
            <div class="ultima-botones">
              <button type="button" class="btn-usar" @click="repetirUltimo">
                Sí, usar este pedido
              </button>
              <button type="button" class="btn-otro" @click="ultimo = null">
                No, crear uno nuevo
              </button>
            </div>
          </div>
        </div>

        <div class="familias" role="tablist" aria-label="Familias">
          <button
            v-for="f in catalogo?.familias ?? []"
            :key="f.categoria"
            type="button"
            role="tab"
            class="familia"
            :class="{ activa: familia === f.categoria }"
            :aria-selected="familia === f.categoria"
            @click="familia = f.categoria"
          >
            {{ f.categoria }}
          </button>
        </div>

        <div class="productos">
          <article
            v-for="p in productos"
            :key="p.id"
            class="producto"
            :class="{ agotado: p.agotado, elegido: (cantidades[p.id] ?? 0) > 0 }"
          >
            <div class="foto">
              <img v-if="p.imagenUrl" :src="p.imagenUrl" :alt="p.nombre" loading="lazy" />
              <span v-if="p.agotado" class="cinta">Agotado</span>
            </div>
            <p class="p-nombre">{{ p.nombre }}</p>
            <p class="p-precio">
              {{ dinero(precioDe(p)) }} <span>{{ p.unidad }}</span>
            </p>
            <div class="stepper">
              <button
                type="button"
                class="menos"
                :aria-label="`Quitar uno de ${p.nombre}`"
                :disabled="bloqueada || (cantidades[p.id] ?? 0) === 0"
                @click="sumar(p.id, -1)"
              >
                −
              </button>
              <span>{{ cantidades[p.id] ?? 0 }}</span>
              <button
                type="button"
                :aria-label="`Agregar uno de ${p.nombre}`"
                :disabled="bloqueada || p.agotado"
                @click="sumar(p.id, 1)"
              >
                +
              </button>
            </div>
            <div v-if="p.escalones.length > 0" class="escalones">
              <span class="lleva">Lleva más, paga menos</span>
              <button
                v-for="e in p.escalones"
                :key="e.piso"
                type="button"
                :class="{ activo: cantidades[p.id] === e.piso }"
                :disabled="bloqueada || p.agotado"
                :title="`Desde ${e.piso}: ${dinero(e.precio)} c/u`"
                @click="fijar(p.id, e.piso)"
              >
                {{ e.piso }}
              </button>
            </div>
            <!-- Quitarlo entero de un toque: con el «−» habría que pulsar pieza por pieza. -->
            <button
              v-if="(cantidades[p.id] ?? 0) > 0"
              type="button"
              class="quitar-producto"
              :disabled="bloqueada"
              @click="fijar(p.id, 0)"
            >
              Quitar
            </button>
          </article>
        </div>

        <div class="barra-orden">
          <span>
            {{ pasos[1].resumen }}
            <strong v-if="previa"> · {{ dinero(previa.subtotal) }}</strong>
          </span>
          <button type="button" :disabled="items.length === 0" @click="abrir('pedido')">
            Ver pedido →
          </button>
        </div>
      </template>
    </section>

    <!-- 3. Resumen del pedido -->
    <section v-show="paso === 'pedido'" class="columna col-resumen">
      <h3 class="resumen-titulo">
        Resumen del pedido
        <span v-if="pedido" class="mini-tag">{{ pedido.folio }}</span>
      </h3>

      <p v-if="items.length === 0" class="empty-block">
        La orden está vacía. Agrega productos en el paso «Tienda».
      </p>

      <!--
        En pantalla ancha el pedido va en dos mitades —qué lleva y cómo lo
        paga— para que los botones queden a la vista sin desplazarse.
      -->
      <div class="resumen-cuerpo">
        <div v-if="items.length > 0" class="resumen-mitad">
          <table class="tabla-lineas">
            <thead>
              <tr>
                <th>Producto</th>
                <th class="num">Precio</th>
                <th class="num">Cant.</th>
                <th class="num">Importe</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="linea in previa?.items ?? []" :key="linea.productoId">
                <td>
                  {{ linea.nombre }}
                  <span v-if="linea.agotado" class="aviso-linea">Agotado</span>
                </td>
                <td class="num">{{ dinero(linea.precioUnitario) }}</td>
                <td class="num cant">
                  <button
                    type="button"
                    :aria-label="`Quitar uno de ${linea.nombre}`"
                    :disabled="bloqueada"
                    @click="sumar(linea.productoId, -1)"
                  >
                    −
                  </button>
                  {{ linea.cantidad }}
                  <button
                    type="button"
                    :aria-label="`Agregar uno de ${linea.nombre}`"
                    :disabled="bloqueada"
                    @click="sumar(linea.productoId, 1)"
                  >
                    +
                  </button>
                </td>
                <td class="num">
                  {{ dinero(linea.importe) }}
                  <button
                    type="button"
                    class="quitar"
                    :aria-label="`Quitar ${linea.nombre}`"
                    :disabled="bloqueada"
                    @click="fijar(linea.productoId, 0)"
                  >
                    🗑
                  </button>
                </td>
              </tr>
            </tbody>
            <tfoot v-if="previa">
              <tr>
                <td colspan="3">Subtotal</td>
                <td class="num">{{ dinero(previa.subtotal) }}</td>
              </tr>
              <tr v-if="previa.envio > 0">
                <td colspan="3">Envío</td>
                <td class="num">{{ dinero(previa.envio) }}</td>
              </tr>
              <tr v-if="previa.billetera > 0">
                <td colspan="3">Billetera electrónica</td>
                <td class="num">−{{ dinero(previa.billetera) }}</td>
              </tr>
            </tfoot>
          </table>

          <p class="subtitulo">Método de envío</p>
          <label class="opcion">
            <input v-model="metodoEntrega" type="radio" value="TIENDA" :disabled="bloqueada" />
            Recoger en tienda
          </label>
          <label class="opcion" :class="{ apagada: !cliente?.direccion }">
            <input
              v-model="metodoEntrega"
              type="radio"
              value="DOMICILIO"
              :disabled="bloqueada || !cliente?.direccion"
            />
            Envío a domicilio
            <span class="nota-opcion">
              {{ cliente?.direccion ?? 'Sin dirección completa en su perfil' }}
            </span>
          </label>

          <div v-if="previa" class="totales" :class="{ calculando }">
            <p class="total">
              <span>Total</span><span>{{ dinero(previa.total) }}</span>
            </p>
            <p class="a-pagar">
              <span>Total a pagar</span><span>{{ dinero(previa.aPagar) }}</span>
            </p>
            <p v-if="previa.cashbackBilletera > 0" class="cashback">
              Gana {{ dinero(previa.cashbackBilletera) }} en su billetera
            </p>
          </div>
        </div>

        <div class="resumen-mitad">
          <template v-if="items.length > 0">
            <p class="subtitulo primero">¿Cómo va a pagar?</p>
            <label v-if="cliente && cliente.saldoBilletera > 0" class="opcion">
              <input v-model="usarBilletera" type="checkbox" :disabled="bloqueada" />
              Usar su billetera electrónica
              <span class="nota-opcion disponible">
                Disponible: {{ dinero(cliente.saldoBilletera) }}
              </span>
            </label>
            <label class="opcion">
              <input v-model="metodoPago" type="radio" value="EFECTIVO" :disabled="bloqueada" />
              Efectivo
            </label>
            <div v-if="metodoPago === 'EFECTIVO'" class="zona-captura">
              <label class="form-label" for="pdv-pago-con">¿Con cuánto paga? (opcional)</label>
              <input
                id="pdv-pago-con"
                v-model="pagoCon"
                class="form-input"
                type="number"
                min="0"
                step="0.01"
                inputmode="decimal"
                :placeholder="previa ? dinero(previa.aPagar) : ''"
                :disabled="bloqueada"
              />
              <p v-if="previa?.pago.cambio != null" class="cambio">
                Cambio: {{ dinero(previa.pago.cambio) }}
              </p>
            </div>
            <label class="opcion">
              <input
                v-model="metodoPago"
                type="radio"
                value="TRANSFERENCIA"
                :disabled="bloqueada"
              />
              Transferencia electrónica
            </label>

            <p v-if="previa?.pago.errorPago" class="form-error">
              {{ previa.pago.errorPago.mensaje }}
            </p>
            <p v-for="(aviso, i) in previa?.avisos ?? []" :key="i" class="form-error">
              {{ aviso }}
            </p>
          </template>

          <p v-if="errorOrden" class="form-error">{{ errorOrden }}</p>
          <p v-if="pedido && pedido.metodoEntrega === 'DOMICILIO'" class="nota-domicilio">
            Va a domicilio: lo prepara Operaciones y lo entrega Rutas.
          </p>

          <div class="botones">
            <button
              type="button"
              class="btn-caja confirmar"
              :disabled="!puedeConfirmar"
              @click="confirmar"
            >
              {{ confirmando ? 'Confirmando…' : 'Confirmar pedido' }}
            </button>
            <button
              type="button"
              class="btn-caja entregado"
              :disabled="!puedeEntregar"
              @click="entregar"
            >
              {{ entregando ? 'Entregando…' : 'Entregado' }}
            </button>
            <button
              type="button"
              class="btn-caja limpiar"
              :disabled="confirmando || entregando"
              @click="limpiar"
            >
              Limpiar orden
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.caja {
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 1fr);
}

/*
 * Los tres pasos en fila: es lo único que siempre está a la vista. Se pegan
 * arriba al desplazarse por el catálogo, para poder saltar a otro paso sin
 * tener que subir. El fondo tapa lo que pasa por debajo.
 */
.pasos {
  position: sticky;
  top: 0;
  z-index: 4;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 4px 0 6px;
  background: var(--cream);
}

.paso {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  border: 1.5px solid var(--line);
  border-radius: 12px;
  background: var(--white);
  padding: 8px 10px;
  text-align: left;
  cursor: pointer;
}

.paso:disabled {
  opacity: 0.5;
  cursor: default;
}

.paso.activo {
  border-color: var(--terracotta);
  background: var(--terracotta);
}

.paso-numero {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--cream-2);
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.paso.activo .paso-numero {
  background: var(--white);
}

.paso-texto {
  min-width: 0;
}

.paso-titulo,
.paso-resumen {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.paso-titulo {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 12.5px;
  color: var(--ink);
}

.paso-resumen {
  font-size: 10.5px;
  color: var(--muted);
}

.paso.activo .paso-titulo,
.paso.activo .paso-resumen {
  color: var(--white);
}

/* El teléfono y el pedido no necesitan todo el ancho: centrados se leen mejor. */
.col-telefono {
  width: 100%;
  max-width: 360px;
  margin: 0 auto;
}

.col-resumen {
  width: 100%;
  max-width: 620px;
  margin: 0 auto;
}

@media (min-width: 900px) {
  .col-resumen {
    max-width: 1000px;
  }

  .resumen-cuerpo {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
    gap: 0 28px;
    align-items: start;
  }

  .subtitulo.primero {
    margin-top: 0;
  }
}

.columna {
  background: var(--white);
  border-radius: 14px;
  box-shadow: var(--shadow);
  padding: 14px;
  min-width: 0;
}

.titulo-columna {
  display: block;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink);
  margin-bottom: 8px;
}

/* ---- Teléfono ---- */

.visor {
  width: 100%;
  font-size: 22px;
  font-family: var(--font-heading);
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink);
  background: var(--white);
  border: 1.5px solid var(--line);
  border-radius: 11px;
  padding: 10px 12px;
  margin-bottom: 10px;
  outline: none;
}

.visor:focus {
  border-color: var(--terracotta);
}

.visor:disabled {
  background: var(--cream);
  color: var(--muted);
}

.sugerencias {
  list-style: none;
  margin: -4px 0 10px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 11px;
  overflow: hidden;
}

.sugerencias li + li {
  border-top: 1px solid var(--line);
}

.sugerencias button {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: var(--white);
  padding: 8px 12px;
  cursor: pointer;
}

.sugerencias button:hover,
.sugerencias button:focus-visible {
  background: var(--cream);
}

.s-telefono {
  display: block;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  letter-spacing: 0.04em;
  color: var(--ink);
}

.s-nombre {
  display: block;
  font-size: 11px;
  color: var(--muted);
}

.teclado {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  background: var(--cream);
  border-radius: 12px;
  padding: 8px;
  margin-bottom: 10px;
}

.tecla {
  height: 52px;
  border: none;
  border-radius: 10px;
  background: var(--white);
  box-shadow: var(--shadow);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 20px;
  color: var(--ink);
  cursor: pointer;
}

.tecla:disabled {
  opacity: 0.45;
  cursor: default;
}

.zona-captura {
  background: var(--cream);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 10px 12px 2px;
  margin-bottom: 10px;
}

.btn-ingresar {
  width: 100%;
  height: 46px;
  border: none;
  border-radius: 11px;
  background: var(--cream-2);
  color: var(--ink);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.btn-ingresar:disabled {
  opacity: 0.6;
}

.btn-ingresar + .btn-ingresar {
  margin-top: 8px;
}

.btn-ingresar.seguir {
  background: var(--sage);
  color: var(--white);
}

.atendiendo {
  font-size: 12.5px;
  color: var(--muted);
  margin: 0 0 10px;
  text-align: center;
}

.atendiendo strong {
  color: var(--ink);
}

/* ---- Cliente y última compra ---- */

.cabecera-cliente {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.cliente {
  background: color-mix(in srgb, var(--sage) 16%, var(--white));
  border-radius: 12px;
  padding: 10px 12px;
  min-width: 130px;
}

.cliente .titulo-columna {
  margin-bottom: 2px;
}

.cliente .nombre {
  display: block;
  font-size: 14px;
  color: var(--ink);
}

.ultima-compra {
  flex: 1;
  min-width: 220px;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 8px 10px;
}

.ultima-titulo {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11.5px;
  color: var(--ink);
  margin: 0 0 4px;
}

.ultima-compra .agotada td {
  color: var(--muted);
  text-decoration: line-through;
}

.ultima-botones {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.btn-usar,
.btn-otro {
  flex: 1;
  border-radius: 8px;
  padding: 7px 8px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11px;
  cursor: pointer;
}

.btn-usar {
  border: none;
  background: var(--sage);
  color: var(--white);
}

.btn-otro {
  border: 1px solid var(--line);
  background: var(--white);
  color: var(--ink);
}

/* ---- Catálogo ---- */

.familias {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 6px;
  margin-bottom: 10px;
}

.familia {
  flex-shrink: 0;
  border: none;
  border-radius: 10px 10px 0 0;
  padding: 9px 14px;
  background: var(--cream-2);
  color: var(--ink);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 12.5px;
  cursor: pointer;
}

.familia.activa {
  background: var(--terracotta);
  color: var(--white);
}

.productos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
  gap: 10px;
}

.producto {
  border: 1.5px solid var(--line);
  border-radius: 12px;
  padding: 6px 6px 8px;
  text-align: center;
  background: var(--white);
}

.producto.elegido {
  border-color: var(--sage);
}

.producto.agotado {
  opacity: 0.55;
}

.foto {
  position: relative;
  aspect-ratio: 4 / 3;
  border-radius: 9px;
  overflow: hidden;
  background: var(--cream);
}

.foto img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cinta {
  position: absolute;
  top: 6px;
  left: 0;
  background: var(--terracotta-dark);
  color: var(--white);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 9.5px;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 0 6px 6px 0;
}

.p-nombre {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 10.5px;
  text-transform: uppercase;
  color: var(--ink);
  line-height: 1.25;
  margin: 6px 0 2px;
  min-height: 2.5em;
}

.p-precio {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 15px;
  color: var(--ink);
  margin: 0 0 6px;
}

.p-precio span {
  font-weight: 400;
  font-size: 9.5px;
  color: var(--muted);
}

.stepper {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
}

/* Botones de dedo: en la caja se toca, no se apunta con ratón. */
.stepper button {
  width: 36px;
  height: 36px;
  font-size: 20px;
}

.stepper button.menos:not(:disabled) {
  border-color: var(--terracotta);
  color: var(--terracotta-dark);
}

.quitar-producto {
  display: block;
  margin: 6px auto 0;
  border: none;
  background: none;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11px;
  text-decoration: underline;
  cursor: pointer;
  padding: 4px 8px;
}

.quitar-producto:disabled {
  opacity: 0.4;
  cursor: default;
}

.barra-orden {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 12px -14px -14px;
  padding: 10px 14px;
  background: var(--cream);
  border-top: 1px solid var(--line);
  border-radius: 0 0 14px 14px;
  font-size: 12.5px;
  color: var(--ink);
}

.barra-orden button {
  border: none;
  border-radius: 10px;
  background: var(--sage);
  color: var(--white);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 12.5px;
  padding: 10px 16px;
  cursor: pointer;
}

.barra-orden button:disabled {
  opacity: 0.4;
  cursor: default;
}

.stepper button,
.cant button {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: var(--white);
  color: var(--ink);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.stepper button:disabled,
.cant button:disabled,
.quitar:disabled {
  opacity: 0.4;
  cursor: default;
}

.escalones {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: 6px;
}

.lleva {
  background: var(--gold);
  color: var(--ink);
  border-radius: 5px;
  padding: 2px 4px;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 6.5px;
  text-transform: uppercase;
  line-height: 1.15;
  max-width: 46px;
}

.escalones button {
  min-width: 24px;
  height: 22px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--white);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 10.5px;
  color: var(--ink);
  cursor: pointer;
}

.escalones button.activo {
  border-color: var(--sage);
  background: color-mix(in srgb, var(--sage) 16%, var(--white));
}

/* ---- Resumen ---- */

.resumen-titulo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 14px;
  color: var(--sage);
  margin: 0 0 10px;
}

.col-resumen .tabla-lineas {
  width: 100%;
}

.cant {
  white-space: nowrap;
}

.cant button {
  width: 20px;
  height: 20px;
  font-size: 12px;
}

.quitar {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  padding: 0 0 0 2px;
}

.aviso-linea {
  display: block;
  font-size: 10px;
  color: var(--terracotta);
}

.subtitulo {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  margin: 14px 0 6px;
}

.opcion {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  color: var(--ink);
  padding: 7px 0;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
}

.opcion input {
  accent-color: var(--sage);
}

.opcion.apagada {
  color: var(--muted);
  cursor: default;
}

.nota-opcion {
  flex-basis: 100%;
  font-family: var(--font-body);
  font-weight: 400;
  font-size: 10.5px;
  color: var(--muted);
  padding-left: 22px;
}

.nota-opcion.disponible {
  color: var(--sage);
  font-weight: 700;
}

.totales {
  margin-top: 12px;
  border-top: 2px solid var(--sage);
  padding-top: 8px;
}

.totales.calculando {
  opacity: 0.5;
}

.total,
.a-pagar {
  display: flex;
  justify-content: space-between;
  font-family: var(--font-heading);
  font-weight: 800;
  margin: 0 0 4px;
}

.total {
  font-size: 15px;
  color: var(--sage);
}

.a-pagar {
  font-size: 17px;
  color: var(--ink);
  text-transform: uppercase;
}

.cashback,
.cambio,
.nota-domicilio {
  font-size: 11px;
  color: var(--muted);
  margin: 0 0 8px;
}

.cambio {
  font-family: var(--font-heading);
  font-weight: 700;
  color: var(--sage);
}

.col-resumen .zona-captura {
  margin: 6px 0;
}

.botones {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}

.btn-caja {
  height: 48px;
  border: none;
  border-radius: 11px;
  color: var(--white);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.btn-caja:disabled {
  opacity: 0.4;
  cursor: default;
}

.btn-caja.confirmar {
  background: var(--sage);
}

.btn-caja.entregado {
  background: var(--terracotta);
}

.btn-caja.limpiar {
  background: var(--muted);
}
</style>
