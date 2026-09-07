<script setup lang="ts">
/**
 * Mis Pedidos: historial del cliente (`GET /pedidos/mios`).
 *
 * Es la única sección del panel que un cliente tiene en su menú, así que se
 * llega tanto desde el Perfil como desde el drawer.
 */
import { onMounted, ref } from 'vue'
import { http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fechaHora } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import type { Pedido } from '@/api/tipos'

const ui = useUiStore()

const pedidos = ref<Pedido[]>([])
const cargando = ref(true)
const abierto = ref<string | null>(null)

onMounted(async () => {
  try {
    pedidos.value = await http.get<Pedido[]>('/pedidos/mios')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
})

function alternar(id: string): void {
  abierto.value = abierto.value === id ? null : id
}
</script>

<template>
  <div class="pedidos">
    <SkeletonList v-if="cargando" :cantidad="3" />

    <template v-else-if="pedidos.length > 0">
      <article v-for="pedido in pedidos" :key="pedido.id" class="pedido-card">
        <button type="button" class="pedido-cabecera" @click="alternar(pedido.id)">
          <div class="pedido-info">
            <p class="folio">{{ pedido.folio }}</p>
            <p class="fecha">{{ fechaHora(pedido.creadoEn) }}</p>
          </div>
          <div class="pedido-derecha">
            <span class="mini-tag">{{ pedido.estado }}</span>
            <span class="total">{{ dinero(pedido.total) }}</span>
          </div>
          <span class="chev" :class="{ abierto: abierto === pedido.id }">›</span>
        </button>

        <div v-if="abierto === pedido.id" class="pedido-detalle">
          <ul class="lineas">
            <li v-for="item in pedido.items" :key="item.productoId">
              <span class="cantidad">{{ item.cantidad }}×</span>
              <span class="nombre">{{ item.nombre }}</span>
              <span class="importe">{{ dinero(item.importe) }}</span>
            </li>
          </ul>

          <div class="resumen">
            <div class="fila"><span>Productos</span><span>{{ dinero(pedido.subtotal) }}</span></div>
            <div class="fila">
              <span>Envío</span>
              <span>{{ pedido.envio === 0 ? 'Gratis' : dinero(pedido.envio) }}</span>
            </div>
            <div v-if="pedido.recargoFuera > 0" class="fila">
              <span>Recargo fuera de horario</span><span>{{ dinero(pedido.recargoFuera) }}</span>
            </div>
            <div v-if="pedido.descuento > 0" class="fila descuento">
              <span>Descuento{{ pedido.cupon ? ` (${pedido.cupon.code})` : '' }}</span>
              <span>−{{ dinero(pedido.descuento) }}</span>
            </div>
            <div class="fila total-fila">
              <span>Total</span><span>{{ dinero(pedido.total) }}</span>
            </div>
            <p v-if="pedido.cashbackGenerado > 0" class="cashback">
              Cashback generado: {{ dinero(pedido.cashbackGenerado) }}
            </p>
          </div>
        </div>
      </article>
    </template>

    <p v-else class="empty-block">Todavía no has hecho ningún pedido.</p>
  </div>
</template>

<style scoped>
.pedidos {
  padding: 12px 18px 24px;
}

.pedido-card {
  background: var(--white);
  border-radius: 16px;
  box-shadow: var(--shadow);
  margin-bottom: 12px;
  overflow: hidden;
}

.pedido-cabecera {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  background: none;
  border: none;
  padding: 14px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}

.pedido-info {
  flex: 1;
  min-width: 0;
}

.folio {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  color: var(--terracotta-dark);
  letter-spacing: 0.04em;
  margin: 0;
}

.fecha {
  font-size: 11px;
  color: var(--muted);
  margin: 3px 0 0;
}

.pedido-derecha {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.total {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 14px;
  color: var(--ink);
}

.chev {
  font-size: 20px;
  color: var(--muted);
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.chev.abierto {
  transform: rotate(90deg);
}

.pedido-detalle {
  border-top: 1px solid var(--line);
  padding: 12px 14px 14px;
}

.lineas {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
}

.lineas li {
  display: flex;
  gap: 8px;
  font-size: 12.5px;
  color: var(--ink);
  padding: 4px 0;
}

.lineas .cantidad {
  font-family: var(--font-heading);
  font-weight: 700;
  color: var(--muted);
  flex-shrink: 0;
}

.lineas .nombre {
  flex: 1;
  min-width: 0;
}

.lineas .importe {
  flex-shrink: 0;
  font-weight: 600;
}

.resumen {
  border-top: 1px solid var(--line);
  padding-top: 10px;
}

.fila {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
  color: var(--ink);
  padding: 4px 0;
}

.fila.descuento {
  color: var(--sage);
  font-weight: 700;
}

.fila.total-fila {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 14.5px;
  color: var(--terracotta-dark);
  border-top: 1px solid var(--line);
  margin-top: 4px;
  padding-top: 8px;
}

.cashback {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11.5px;
  color: var(--sage);
  text-align: right;
  margin: 8px 0 0;
}
</style>
