<script setup lang="ts">
/**
 * Bitácora de un pedido en hoja modal: quién lo movió, cuándo y de qué a qué,
 * en sus dos ejes (pedido y pago). La usan Operaciones, Rutas y Finanzas.
 */
import { onMounted, ref } from 'vue'
import { http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { fechaHora, nombreEstadoPago, nombreEstadoPedido } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import type { EstadoPago, EstadoPedido, RenglonBitacora } from '@/api/tipos'

const props = defineProps<{ pedidoId: string; folio: string }>()
const emit = defineEmits<{ cerrar: [] }>()

const ui = useUiStore()
const renglones = ref<RenglonBitacora[]>([])
const cargando = ref(true)

onMounted(async () => {
  try {
    renglones.value = await http.get<RenglonBitacora[]>(`/admin/pedidos/${props.pedidoId}/bitacora`)
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
})

/** Los estados llegan como texto porque la columna mezcla los dos ejes. */
function nombre(renglon: RenglonBitacora, estado: string): string {
  return renglon.eje === 'PAGO'
    ? nombreEstadoPago(estado as EstadoPago)
    : nombreEstadoPedido(estado as EstadoPedido)
}

const QUIEN: Record<RenglonBitacora['actor'], string> = {
  CLIENTE: 'Cliente',
  PERSONAL: 'Personal',
  SISTEMA: 'Sistema',
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('cerrar')">
    <div class="modal-sheet" role="dialog" :aria-label="`Bitácora del pedido ${folio}`">
      <div class="modal-handle" />
      <p class="modal-title">Bitácora · {{ folio }}</p>

      <SkeletonList v-if="cargando" :cantidad="3" />

      <!-- De la más reciente a la más antigua: lo último es lo que se busca. -->
      <ol v-else-if="renglones.length > 0" class="renglones">
        <li v-for="renglon in [...renglones].reverse()" :key="renglon.id" class="renglon">
          <span class="eje" :class="renglon.eje === 'PAGO' ? 'pago' : 'pedido'">
            {{ renglon.eje === 'PAGO' ? 'Pago' : 'Pedido' }}
          </span>
          <div class="cuerpo">
            <p class="cambio">
              <template v-if="renglon.estadoAnterior">
                {{ nombre(renglon, renglon.estadoAnterior) }} →
              </template>
              <strong>{{ nombre(renglon, renglon.estadoNuevo) }}</strong>
            </p>
            <p class="quien">
              {{ renglon.actorNombre }} · {{ QUIEN[renglon.actor] }} ·
              {{ fechaHora(renglon.creadoEn) }}
            </p>
            <p v-if="renglon.nota" class="nota">{{ renglon.nota }}</p>
          </div>
        </li>
      </ol>

      <p v-else class="empty-block">Este pedido todavía no tiene movimientos.</p>

      <div class="modal-actions">
        <button type="button" class="btn-cancel" @click="emit('cerrar')">Cerrar</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.renglones {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
}

.renglon {
  display: flex;
  gap: 10px;
  background: var(--white);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  margin-bottom: 8px;
}

.eje {
  flex-shrink: 0;
  align-self: flex-start;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 2px 8px;
  border-radius: 8px;
}

.eje.pedido {
  background: var(--cream-2);
  color: var(--verde-dark);
}

.eje.pago {
  background: var(--cream-2);
  color: var(--orange-dark);
}

.cuerpo {
  flex: 1;
  min-width: 0;
}

.cambio {
  margin: 0;
  font-size: 13px;
  color: var(--ink);
}

.quien {
  margin: 3px 0 0;
  font-size: 11px;
  color: var(--muted);
}

.nota {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--ink);
  font-style: italic;
}
</style>
