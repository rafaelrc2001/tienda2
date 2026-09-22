<script setup lang="ts">
/**
 * Administración → Operaciones: surtir los pedidos y dejarlos listos para
 * entrega, o entregarlos en mostrador si se recogen en tienda.
 *
 * La pantalla no decide nada: cada pedido llega con su `paso` calculado por la
 * API (siguiente estado, a quién le toca y por qué está bloqueado). Aquí solo
 * se enciende el botón o se enseña el candado.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import {
  dinero,
  fechaHora,
  nombreEstadoPago,
  nombreEstadoPedido,
  nombreMetodoPago,
} from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import BitacoraPedido from '@/components/BitacoraPedido.vue'
import type {
  EstadoPago,
  EstadoPedido,
  FiltroOperaciones,
  ListadoOperaciones,
  PedidoEnPantalla,
} from '@/api/tipos'

const ui = useUiStore()

const PESTANAS: { filtro: FiltroOperaciones; titulo: string }[] = [
  { filtro: 'activos', titulo: 'Por surtir' },
  { filtro: 'en-ruta', titulo: 'En ruta' },
  { filtro: 'entregados', titulo: 'Entregados' },
  { filtro: 'cancelados', titulo: 'Cancelados' },
]

const filtro = ref<FiltroOperaciones>('activos')
const pedidos = ref<PedidoEnPantalla[]>([])
const conteos = ref<Record<FiltroOperaciones, number> | null>(null)
const cargando = ref(true)
const abierto = ref<string | null>(null)
const avanzando = ref<string | null>(null)
const bitacoraDe = ref<PedidoEnPantalla | null>(null)

/** Cambiar de pestaña rápido deja respuestas viejas en el aire: gana la última. */
let peticion = 0

async function cargar(conEsqueleto = true): Promise<void> {
  const numero = ++peticion
  if (conEsqueleto) cargando.value = true
  try {
    const respuesta = await http.get<ListadoOperaciones>('/admin/operaciones/pedidos', {
      query: { filtro: filtro.value },
    })
    if (numero !== peticion) return
    pedidos.value = respuesta.pedidos
    conteos.value = respuesta.conteos
  } catch (fallo) {
    if (numero === peticion) ui.errorDeApi(fallo)
  } finally {
    if (numero === peticion) cargando.value = false
  }
}

onMounted(() => cargar())

function elegir(nuevo: FiltroOperaciones): void {
  if (nuevo === filtro.value) return
  filtro.value = nuevo
  abierto.value = null
  void cargar()
}

async function avanzar(pedido: PedidoEnPantalla): Promise<void> {
  const destino = pedido.paso.siguiente
  if (!destino || avanzando.value) return
  avanzando.value = pedido.id
  try {
    const actualizado = await http.patch<PedidoEnPantalla>(
      `/admin/operaciones/pedidos/${pedido.id}/estado`,
      { estado: destino },
    )
    ui.exito(`${pedido.folio} → ${nombreEstadoPedido(actualizado.estado)}`)
    pedidos.value = pedidos.value.map((p) => (p.id === actualizado.id ? actualizado : p))
  } catch (fallo) {
    // Un 409 casi siempre es que alguien más (Finanzas, otro compañero) lo
    // movió mientras tanto: se avisa y se recarga para enseñar lo vigente.
    ui.errorDeApi(fallo)
    if (!(fallo instanceof ErrorApi) || fallo.estado !== 409) return
  } finally {
    avanzando.value = null
  }
  // Lo que ya salió de la pestaña (p. ej. entregado en tienda) se va de la
  // lista, y los contadores se ponen al día.
  await cargar(false)
}

function alternar(id: string): void {
  abierto.value = abierto.value === id ? null : id
}

/** Solo el pedido cancelado dice «Cancelado» en lugar de su paso físico. */
function etiquetaEstado(pedido: PedidoEnPantalla): string {
  return nombreEstadoPedido(pedido.estado, pedido.pago.estado)
}

/** Color del estado de pago: lo que frena va en ámbar o gris, lo cancelado en rojo. */
function clasePago(estado: EstadoPago): string {
  if (estado === 'CANCELADO') return 'pago-cancelado'
  if (estado === 'PAGO_PENDIENTE') return 'pago-pendiente'
  if (estado === 'RETENER') return 'pago-retenido'
  return 'pago-liberado'
}

function direccionCorta(pedido: PedidoEnPantalla): string {
  const d = pedido.direccion as Record<string, string | null> | null
  if (!d) return ''
  return [d.calle, d.colonia, d.ciudad].filter(Boolean).join(' · ')
}

const TITULO_PASO: Partial<Record<EstadoPedido, string>> = {
  EN_PREPARACION: 'Empezar a preparar',
  PREPARADO: 'Marcar preparado',
  LISTO_PARA_ENTREGA: 'Listo para entrega',
  ENTREGADO: 'Entregar en tienda',
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <div class="subtab-row" role="tablist">
      <button
        v-for="p in PESTANAS"
        :key="p.filtro"
        type="button"
        role="tab"
        class="subtab"
        :class="{ active: filtro === p.filtro }"
        :aria-selected="filtro === p.filtro"
        @click="elegir(p.filtro)"
      >
        {{ p.titulo }}<template v-if="conteos"> · {{ conteos[p.filtro] }}</template>
      </button>
    </div>

    <SkeletonList v-if="cargando" :cantidad="4" />

    <template v-else-if="pedidos.length > 0">
      <article v-for="pedido in pedidos" :key="pedido.id" class="pedido">
        <header class="cabecera">
          <div>
            <p class="folio">{{ pedido.folio }}</p>
            <p class="fecha">{{ fechaHora(pedido.creadoEn) }}</p>
          </div>
          <span class="total">{{ dinero(pedido.total) }}</span>
        </header>

        <p class="cliente">
          {{ pedido.clienteNombre ?? '—' }} ·
          {{ pedido.metodoEntrega === 'TIENDA' ? '🏪 Recoge en tienda' : '🛵 A domicilio' }}
        </p>

        <div class="etiquetas">
          <span class="mini-tag">{{ etiquetaEstado(pedido) }}</span>
          <span class="mini-tag" :class="clasePago(pedido.pago.estado)">
            {{ nombreEstadoPago(pedido.pago.estado) }}
          </span>
        </div>

        <!-- Acción: el botón del paso, o por qué no se puede dar. -->
        <div v-if="pedido.pago.estado !== 'CANCELADO'" class="accion">
          <template v-if="pedido.paso.siguiente && pedido.paso.seccion === 'operaciones'">
            <button
              type="button"
              class="btn-primary"
              :disabled="pedido.paso.bloqueo !== null || avanzando === pedido.id"
              @click="avanzar(pedido)"
            >
              <template v-if="avanzando === pedido.id">…</template>
              <template v-else>
                {{ pedido.paso.bloqueo ? '🔒 ' : ''
                }}{{ TITULO_PASO[pedido.paso.siguiente] ?? nombreEstadoPedido(pedido.paso.siguiente) }}
              </template>
            </button>
            <p v-if="pedido.paso.bloqueo" class="bloqueo">{{ pedido.paso.bloqueo.mensaje }}</p>
          </template>
          <p v-else-if="pedido.paso.siguiente" class="aviso">
            🛵 Listo en bodega: lo recoge Rutas para salir a domicilio.
          </p>
          <p v-else class="aviso hecho">✓ Entregado</p>
        </div>

        <div class="enlaces">
          <button type="button" class="enlace" @click="alternar(pedido.id)">
            {{ abierto === pedido.id ? 'Ocultar detalle' : 'Ver detalle' }}
          </button>
          <button type="button" class="enlace" @click="bitacoraDe = pedido">Bitácora</button>
        </div>

        <div v-if="abierto === pedido.id" class="detalle">
          <ul class="lineas">
            <li v-for="item in pedido.items" :key="item.productoId">
              <span class="cantidad">{{ item.cantidad }} {{ item.unidad }}</span>
              <span class="nombre">{{ item.nombre }}</span>
              <span class="importe">{{ dinero(item.importe) }}</span>
            </li>
          </ul>

          <div class="fila"><span>Productos</span><span>{{ dinero(pedido.subtotal) }}</span></div>
          <div v-if="pedido.metodoEntrega === 'DOMICILIO'" class="fila">
            <span>Envío</span>
            <span>{{ pedido.envio === 0 ? 'Gratis' : dinero(pedido.envio) }}</span>
          </div>
          <div v-if="pedido.recargoFuera > 0" class="fila">
            <span>Recargo fuera de horario</span><span>{{ dinero(pedido.recargoFuera) }}</span>
          </div>
          <div v-if="pedido.descuento > 0" class="fila">
            <span>{{ pedido.cupon ? `Cupón ${pedido.cupon.code}` : 'Descuento' }}</span>
            <span>−{{ dinero(pedido.descuento) }}</span>
          </div>
          <div v-if="pedido.pago.billetera > 0" class="fila">
            <span>Pagó con su billetera</span><span>−{{ dinero(pedido.pago.billetera) }}</span>
          </div>
          <div class="fila fuerte">
            <span>
              {{
                pedido.pago.aPagar > 0 ? `A cobrar · ${nombreMetodoPago(pedido.pago.metodo)}` : 'Cubierto'
              }}
            </span>
            <span>{{ dinero(pedido.pago.aPagar) }}</span>
          </div>
          <p v-if="pedido.pago.pagoCon !== null && pedido.pago.cambio !== null" class="nota-pago">
            💵 Paga con {{ dinero(pedido.pago.pagoCon) }} · Cambio {{ dinero(pedido.pago.cambio) }}
          </p>
          <p v-if="direccionCorta(pedido)" class="nota-pago">📍 {{ direccionCorta(pedido) }}</p>
        </div>
      </article>
    </template>

    <p v-else class="empty-block">
      {{
        filtro === 'activos' ? 'No hay pedidos por surtir. 🎉' : 'No hay pedidos en esta pestaña.'
      }}
    </p>

    <BitacoraPedido
      v-if="bitacoraDe"
      :pedido-id="bitacoraDe.id"
      :folio="bitacoraDe.folio"
      @cerrar="bitacoraDe = null"
    />
  </div>
</template>

<style scoped>
.pantalla {
  padding: 12px 18px 0;
}

.admin-back-inline {
  display: inline-block;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  padding: 0 0 8px;
  text-decoration: none;
}

.subtab-row {
  margin: 0 0 12px;
}

.pedido {
  background: var(--white);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
  padding: 14px;
  margin-bottom: 12px;
}

.cabecera {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.folio {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  color: var(--terracotta-dark);
  letter-spacing: 0.04em;
}

.fecha {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--muted);
}

.total {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 15px;
  color: var(--ink);
  white-space: nowrap;
}

.cliente {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: var(--ink);
}

.etiquetas {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.mini-tag.pago-pendiente {
  background: var(--amarillo);
  color: var(--ink);
}

.mini-tag.pago-retenido {
  background: var(--gris-oscuro);
  color: var(--white);
}

.mini-tag.pago-liberado {
  background: var(--verde);
  color: var(--white);
}

.mini-tag.pago-cancelado {
  background: var(--rojo);
  color: var(--white);
}

.accion {
  margin-top: 12px;
}

.accion .btn-primary {
  width: 100%;
}

.bloqueo {
  margin: 8px 0 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--orange-dark);
}

.aviso {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}

.aviso.hecho {
  color: var(--verde-dark);
}

.enlaces {
  display: flex;
  gap: 16px;
  margin-top: 10px;
}

.enlace {
  background: none;
  border: none;
  padding: 4px 0;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  color: var(--terracotta-dark);
  cursor: pointer;
}

.detalle {
  border-top: 1px solid var(--line);
  margin-top: 10px;
  padding-top: 10px;
}

.lineas {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
}

.lineas li {
  display: flex;
  gap: 8px;
  font-size: 12.5px;
  color: var(--ink);
  padding: 3px 0;
}

.lineas .cantidad {
  flex-shrink: 0;
  font-family: var(--font-heading);
  font-weight: 700;
  color: var(--muted);
}

.lineas .nombre {
  flex: 1;
  min-width: 0;
}

.lineas .importe {
  flex-shrink: 0;
  font-weight: 600;
}

.fila {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
  color: var(--ink);
  padding: 3px 0;
}

.fila.fuerte {
  font-family: var(--font-heading);
  font-weight: 800;
  border-top: 1px solid var(--line);
  margin-top: 4px;
  padding-top: 7px;
}

.nota-pago {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--ink);
}
</style>
