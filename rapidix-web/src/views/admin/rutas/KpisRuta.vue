<script setup lang="ts">
/**
 * El encabezado de una entrega: cuántos de sus pedidos se entregaron, cuántos
 * regresan y el efectivo que pide su corte. Es de cada viaje, no del día: vive
 * dentro de la pantalla de la entrega.
 *
 * El efectivo esperado lo calcula la API con lo que de verdad se entregó —en
 * una entrega parcial el total del pedido cobraría de más—; aquí solo se pinta.
 */
import { computed } from 'vue'
import { dinero } from '@/utils/formato'
import { porcentajeDeExito } from './liquidacion'
import type { IndicadoresRuta } from '@/api/tipos'

const props = defineProps<{ indicadores: IndicadoresRuta | null }>()

const exito = computed(() =>
  props.indicadores
    ? porcentajeDeExito(props.indicadores.entregados, props.indicadores.pedidos)
    : 0,
)
</script>

<template>
  <section class="kpis-ruta" aria-label="Resumen de esta entrega">
    <div class="kpis">
      <div class="kpi">
        <span class="kpi-label">⊕ Entregas</span>
        <span class="kpi-valor">
          <template v-if="indicadores">
            {{ indicadores.entregados }}/{{ indicadores.pedidos }}
          </template>
          <template v-else>—</template>
        </span>
        <span class="kpi-sub">{{ exito }}% de éxito</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">💵 Efectivo esperado</span>
        <span class="kpi-valor">{{
          indicadores ? dinero(indicadores.efectivoEsperado) : '—'
        }}</span>
        <span class="kpi-sub">según entregas</span>
      </div>
    </div>

    <div class="tiles">
      <div class="tile">
        <span class="tile-label">Pedidos totales</span>
        <span class="tile-valor">{{ indicadores?.pedidos ?? '—' }}</span>
      </div>
      <div class="tile">
        <span class="tile-label">Entregados</span>
        <span class="tile-valor">{{ indicadores?.entregados ?? '—' }}</span>
      </div>
      <div class="tile">
        <span class="tile-label">Devoluciones</span>
        <span class="tile-valor">{{ indicadores?.devoluciones ?? '—' }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.kpis-ruta {
  margin-bottom: 12px;
}

/* `minmax(0, 1fr)` y no `1fr`: con `1fr` un monto largo empuja la rejilla fuera. */
.kpis {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 8px;
}

.kpi {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--verde-dark);
  color: var(--white);
  border-radius: var(--radius-md);
  padding: 12px 13px;
}

.kpi-label {
  font-family: var(--font-heading);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  opacity: 0.85;
  line-height: 1.2;
  margin-bottom: 4px;
}

/* Encoge antes que desbordar: por eso no hay media query que apile las tarjetas. */
.kpi-valor {
  font-family: var(--font-heading);
  font-size: clamp(17px, 5.2vw, 23px);
  font-weight: 800;
  line-height: 1.05;
  overflow-wrap: anywhere;
}

.kpi-sub {
  font-size: 11px;
  opacity: 0.8;
  margin-top: 2px;
}

/* Los secundarios: el mismo verde, un poco más tenue. */
.tiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.tile {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--verde-dark);
  color: var(--white);
  opacity: 0.92;
  border-radius: var(--radius-sm);
  padding: 9px 8px;
  text-align: center;
}

.tile-label {
  font-family: var(--font-heading);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  opacity: 0.85;
  margin-bottom: 4px;
  line-height: 1.2;
}

.tile-valor {
  font-family: var(--font-heading);
  font-size: 18px;
  font-weight: 800;
  line-height: 1.1;
}

@media (max-width: 420px) {
  .kpi {
    padding: 11px 10px;
  }

  .tile {
    padding: 8px 5px;
  }

  .tile-label {
    font-size: 9px;
  }
}
</style>
