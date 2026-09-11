<script setup lang="ts">
/**
 * Carrito y confirmación del pedido (Word 4.3 y 6.3).
 *
 * El desglose sale entero de `POST /carrito/previsualizar` y se recalcula en
 * cada cambio: **la interfaz no suma ni un peso**. Si al confirmar el total
 * difiere, manda el que devolvió el pedido.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useCarritoStore } from '@/stores/carrito'
import { useUiStore } from '@/stores/ui'
import { dinero } from '@/utils/formato'
import { ErrorApi } from '@/api/http'
import type { Pedido } from '@/api/tipos'

const carrito = useCarritoStore()
const ui = useUiStore()

const cupon = ref(carrito.codigoCupon ?? '')
const aplicandoCupon = ref(false)
const confirmando = ref(false)
const pedidoHecho = ref<Pedido | null>(null)

const previsualizacion = computed(() => carrito.previsualizacion)

/** Fuera de horario con `atenderFuera` apagado no se puede confirmar. */
const motivoBloqueo = computed(() => {
  const p = previsualizacion.value
  if (!p || p.puedePedir) return ''
  if (!p.dentroDeHorario) {
    return p.avisos.find((a) => a.includes('horario')) ?? 'Ahora mismo no estamos recibiendo pedidos.'
  }
  if (p.items.some((i) => i.agotado)) {
    return 'Quita los productos agotados para poder confirmar tu pedido.'
  }
  return 'Tu carrito no se puede pedir todavía.'
})

onMounted(() => {
  if (!carrito.vacio) carrito.recalcular().catch((fallo) => ui.errorDeApi(fallo))
})

watch(
  () => carrito.lineas.map((l) => `${l.productoId}:${l.cantidad}`).join(','),
  () => {
    carrito.recalcular().catch((fallo) => ui.errorDeApi(fallo))
  },
)

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

async function confirmar(): Promise<void> {
  confirmando.value = true
  try {
    pedidoHecho.value = await carrito.confirmar()
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

    <div class="cart-summary-box">
      <div class="cart-summary-row">
        <span>Productos</span><span>{{ dinero(pedidoHecho.subtotal) }}</span>
      </div>
      <div class="cart-summary-row">
        <span>Envío</span>
        <span>{{ pedidoHecho.envio === 0 ? 'Gratis' : dinero(pedidoHecho.envio) }}</span>
      </div>
      <div v-if="pedidoHecho.recargoFuera > 0" class="cart-summary-row">
        <span>Recargo fuera de horario</span><span>{{ dinero(pedidoHecho.recargoFuera) }}</span>
      </div>
      <div v-if="pedidoHecho.descuento > 0" class="cart-summary-row descuento">
        <span>Descuento{{ pedidoHecho.cupon ? ` (${pedidoHecho.cupon.code})` : '' }}</span>
        <span>−{{ dinero(pedidoHecho.descuento) }}</span>
      </div>
      <div class="cart-summary-row total">
        <span>Total</span><span>{{ dinero(pedidoHecho.total) }}</span>
      </div>
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

  <div v-else class="carrito">
    <!-- Avisos de la API: fuera de horario, producto agotado… -->
    <div v-if="previsualizacion && previsualizacion.avisos.length > 0" class="avisos">
      <p v-for="(aviso, i) in previsualizacion.avisos" :key="i" class="aviso">{{ aviso }}</p>
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
            {{ dinero(item.precioUnitario) }} · {{ item.unidad }}
            <span v-if="item.agotado" class="etiqueta-agotado">Agotado</span>
          </p>
        </div>
        <div class="qty-control">
          <button
            type="button"
            aria-label="Quitar uno"
            @click="carrito.quitar(item.productoId)"
          >
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

    <!-- Desglose. Cada línea viene de la API tal cual. -->
    <div v-if="previsualizacion" class="cart-summary-box" :class="{ recalculando: carrito.calculando }">
      <div class="cart-summary-row">
        <span>Productos</span><span>{{ dinero(previsualizacion.subtotal) }}</span>
      </div>
      <div class="cart-summary-row">
        <span>Envío</span>
        <span>{{ previsualizacion.envio === 0 ? 'Gratis' : dinero(previsualizacion.envio) }}</span>
      </div>
      <div v-if="previsualizacion.recargoFuera > 0" class="cart-summary-row">
        <span>Recargo fuera de horario</span>
        <span>{{ dinero(previsualizacion.recargoFuera) }}</span>
      </div>
      <div v-if="previsualizacion.descuento > 0" class="cart-summary-row descuento">
        <span>Descuento{{ previsualizacion.cupon ? ` (${previsualizacion.cupon.codigo})` : '' }}</span>
        <span>−{{ dinero(previsualizacion.descuento) }}</span>
      </div>
      <div class="cart-summary-row total">
        <span>Total</span><span>{{ dinero(previsualizacion.total) }}</span>
      </div>
      <p v-if="previsualizacion.cashbackEstimado > 0" class="cashback-estimado">
        Ganarás {{ dinero(previsualizacion.cashbackEstimado) }} de cashback
      </p>

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
    </div>

    <!--
      El cupón va DEBAJO del total: primero el cliente ve lo que va a
      pagar y luego decide si intenta rebajarlo. El motivo del rechazo
      se pinta aquí mismo, no como toast.
    -->
    <div class="bloque-cupon">
      <label class="form-label" for="cupon">¿Tienes un cupón?</label>
      <div class="fila-cupon">
        <input
          id="cupon"
          v-model="cupon"
          class="form-input"
          :class="{ 'is-invalid': carrito.errorCupon }"
          placeholder="Escribe tu código"
          :disabled="!!previsualizacion?.cupon"
        />
        <button
          v-if="previsualizacion?.cupon"
          type="button"
          class="btn-cancel boton-cupon"
          @click="quitarCupon"
        >
          Quitar
        </button>
        <button
          v-else
          type="button"
          class="btn-secondary boton-cupon"
          :disabled="aplicandoCupon || !cupon.trim()"
          @click="aplicarCupon"
        >
          {{ aplicandoCupon ? '…' : 'Aplicar' }}
        </button>
      </div>
      <p v-if="carrito.errorCupon" class="form-error">{{ carrito.errorCupon }}</p>
      <p v-else-if="previsualizacion?.cupon" class="cupon-ok">
        {{ previsualizacion.cupon.descripcion }}
      </p>
    </div>

    <div class="confirmar-wrap">
      <button
        type="button"
        class="btn-primary ancho"
        :disabled="confirmando || carrito.calculando || !previsualizacion?.puedePedir"
        @click="confirmar"
      >
        {{ confirmando ? 'Confirmando…' : 'Confirmar pedido' }}
      </button>
      <p v-if="motivoBloqueo" class="motivo-bloqueo">{{ motivoBloqueo }}</p>
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

.bloque-cupon {
  margin-top: 6px;
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
  height: 42px;
}

.cupon-ok {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 11.5px;
  color: var(--sage);
  margin: -6px 0 10px;
}

.cart-summary-box {
  background: var(--white);
  border-radius: 14px;
  padding: 14px;
  box-shadow: var(--shadow);
  margin: 12px 0;
  transition: opacity 0.15s ease;
}

.cart-summary-box.recalculando {
  opacity: 0.55;
}

.cart-summary-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
  color: var(--ink);
  padding: 5px 0;
}

.cart-summary-row.descuento {
  color: var(--sage);
  font-weight: 700;
}

.cart-summary-row.total {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 15.5px;
  border-top: 1px solid var(--line);
  margin-top: 6px;
  padding-top: 10px;
  color: var(--terracotta-dark);
}

.cashback-estimado {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11.5px;
  color: var(--sage);
  text-align: right;
  margin: 8px 0 0;
}

.metas {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
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

.confirmar-wrap {
  margin: 6px 0 20px;
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
