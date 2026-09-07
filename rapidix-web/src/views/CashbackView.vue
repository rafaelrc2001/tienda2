<script setup lang="ts">
/**
 * Estado de cuenta del cashback (`GET /perfil/cashback/movimientos`).
 *
 * Solo consulta: gastar el saldo en un pedido no está en la API y queda
 * fuera del SPEC 02.
 */
import { onMounted, ref } from 'vue'
import { http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fechaHora } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import type { EstadoCashback, MovimientoCashback } from '@/api/tipos'

const ui = useUiStore()

const estado = ref<EstadoCashback | null>(null)
const movimientos = ref<MovimientoCashback[]>([])
const cargando = ref(true)

onMounted(async () => {
  try {
    const [saldo, filas] = await Promise.all([
      http.get<EstadoCashback>('/perfil/cashback'),
      http.get<MovimientoCashback[]>('/perfil/cashback/movimientos'),
    ])
    estado.value = saldo
    movimientos.value = filas
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
})
</script>

<template>
  <div class="cashback">
    <RouterLink to="/perfil" class="admin-back-inline">← Volver a Mi Perfil</RouterLink>

    <SkeletonList v-if="cargando" :cantidad="3" />

    <template v-else>
      <div v-if="estado" class="resumen-saldo">
        <p class="lbl">Saldo disponible</p>
        <p class="amt">{{ dinero(estado.saldo) }}</p>
        <p class="nivel">
          Nivel {{ estado.nivelActual ?? 'sin asignar' }} · Total gastado
          {{ dinero(estado.totalGastado) }}
        </p>
      </div>

      <p class="nota">
        Por ahora el saldo es informativo: gastarlo en un pedido llegará en una versión posterior.
      </p>

      <h2 class="section-title"><span class="accent-bar" />Movimientos</h2>

      <ul v-if="movimientos.length > 0" class="movimientos">
        <li v-for="movimiento in movimientos" :key="movimiento.id">
          <div class="mov-info">
            <p class="concepto">{{ movimiento.concepto }}</p>
            <p class="meta">
              {{ fechaHora(movimiento.creadoEn) }}
              <span v-if="movimiento.pedidoFolio"> · {{ movimiento.pedidoFolio }}</span>
            </p>
          </div>
          <span class="monto" :class="{ negativo: movimiento.monto < 0 }">
            {{ movimiento.monto >= 0 ? '+' : '' }}{{ dinero(movimiento.monto) }}
          </span>
        </li>
      </ul>

      <p v-else class="empty-block">Todavía no tienes movimientos de cashback.</p>
    </template>
  </div>
</template>

<style scoped>
.cashback {
  padding: 12px 18px 24px;
}

.admin-back-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  padding: 0 0 14px;
  text-decoration: none;
}

.resumen-saldo {
  background: linear-gradient(135deg, #3b6b45, #2c5233);
  border-radius: 18px;
  padding: 18px;
  color: var(--white);
  box-shadow: var(--shadow);
  margin-bottom: 12px;
}

.resumen-saldo .lbl {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.85;
  font-weight: 700;
  margin: 0;
}

.resumen-saldo .amt {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 28px;
  margin: 4px 0 0;
}

.resumen-saldo .nivel {
  font-size: 11.5px;
  opacity: 0.85;
  margin: 6px 0 0;
}

.nota {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
  margin: 0 0 6px;
}

.section-title {
  margin-left: 0;
  margin-right: 0;
}

.movimientos {
  list-style: none;
  margin: 0;
  padding: 0;
}

.movimientos li {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--white);
  border-radius: 14px;
  padding: 12px 14px;
  margin-bottom: 10px;
  box-shadow: var(--shadow);
}

.mov-info {
  flex: 1;
  min-width: 0;
}

.concepto {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  color: var(--ink);
  margin: 0;
}

.meta {
  font-size: 11px;
  color: var(--muted);
  margin: 3px 0 0;
}

.monto {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 14px;
  color: var(--sage);
  flex-shrink: 0;
}

.monto.negativo {
  color: var(--terracotta);
}
</style>
