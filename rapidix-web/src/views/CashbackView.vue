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
import { dinero, fechaNumerica } from '@/utils/formato'
import { emojiDeNivel, imagenDeNivel } from '@/utils/medallas'
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
        <div>
          <p class="lbl">Saldo disponible</p>
          <p class="amt">{{ dinero(estado.saldo) }}</p>
        </div>
        <div class="medalla">
          <img
            v-if="imagenDeNivel(estado.nivelActual)"
            class="medalla-img"
            :src="imagenDeNivel(estado.nivelActual)!"
            alt=""
          />
          <span v-else class="medalla-emoji">{{ emojiDeNivel(estado.nivelActual) }}</span>
          <span class="nivel">
            {{ estado.nivelActual ? `Nivel ${estado.nivelActual}` : 'Sin nivel' }}
          </span>
        </div>
      </div>

      <h2 class="section-title"><span class="accent-bar" />Movimientos</h2>

      <div v-if="movimientos.length > 0" class="tabla-envoltorio">
        <table class="tabla">
          <thead>
            <tr>
              <th>Concepto</th>
              <th>Fecha</th>
              <th class="num">Monto</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="movimiento in movimientos" :key="movimiento.id">
              <!-- El concepto ya trae el folio del pedido: no hace falta otra columna. -->
              <td>{{ movimiento.concepto }}</td>
              <td class="fecha">{{ fechaNumerica(movimiento.creadoEn) }}</td>
              <td class="num importe" :class="movimiento.monto < 0 ? 'negativo' : 'positivo'">
                {{ movimiento.monto >= 0 ? '+' : '' }}{{ dinero(movimiento.monto) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-else class="empty-block">Todavía no tienes movimientos de Monedero electrónico.</p>
    </template>
  </div>
</template>

<style scoped>
.cashback {
  padding: 12px 18px 0;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: linear-gradient(135deg, #4caf50, #388e3c);
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

.medalla {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.medalla-img {
  width: 96px;
  height: 96px;
  object-fit: contain;
}

.medalla-emoji {
  font-size: 44px;
  line-height: 1;
}

.nivel {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  text-align: center;
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

/* Menos relleno que la tabla base: en un teléfono el movimiento cabe en un renglón. */
.tabla > thead > tr > th,
.tabla > tbody > tr > td {
  padding-left: 8px;
  padding-right: 8px;
}

.tabla > tbody > tr > td {
  font-size: 11.5px;
  vertical-align: middle;
}

/* Fecha y monto no se parten: si un concepto es largo, solo él baja de renglón. */
.tabla > tbody > tr > td.fecha {
  font-size: 10.5px;
  color: var(--muted);
  white-space: nowrap;
}

.tabla > tbody > tr > td.positivo {
  color: var(--sage);
}

.tabla > tbody > tr > td.negativo {
  color: var(--terracotta);
}
</style>
