<script setup lang="ts">
/**
 * «No entregado»: el intento que no llegó a entrega. El pedido **no se
 * cierra** —la mercancía sigue arriba— y por eso no hay nada que contar, solo
 * el motivo, que es obligatorio: de ahí salen los reportes de devolución.
 *
 * Vive aparte porque lo abren la pantalla de Rutas y la de cada entrega.
 */
import { ref } from 'vue'
import { http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { MOTIVOS, nombreMotivo } from './etiquetas'
import type { MotivoDevolucion, PedidoEnRuta } from '@/api/tipos'

const props = defineProps<{ pedido: PedidoEnRuta }>()
const emit = defineEmits<{
  (e: 'cerrar'): void
  /** El intento quedó guardado: quien abrió la hoja relee su lista. */
  (e: 'guardado'): void
}>()

const ui = useUiStore()
const motivo = ref<MotivoDevolucion | null>(null)
const nota = ref('')
const enviando = ref(false)

async function guardar(): Promise<void> {
  if (!motivo.value || enviando.value) return
  enviando.value = true
  try {
    await http.post(`/admin/rutas/pedidos/${props.pedido.id}/no-entregar`, {
      motivo: motivo.value,
      ...(nota.value.trim() ? { nota: nota.value.trim() } : {}),
    })
    ui.info(
      `${props.pedido.folio}: ${nombreMotivo(motivo.value)}. La mercancía sigue en tu camión.`,
    )
    emit('guardado')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('cerrar')">
    <div class="modal-sheet" role="dialog" aria-label="Marcar como no entregado">
      <div class="modal-handle" />
      <p class="modal-title">No entregado · {{ pedido.folio }}</p>
      <p class="modal-texto">
        El pedido no se cierra: la mercancía sigue en tu camión y vuelve a bodega en el corte.
        Puedes intentarlo otra vez hoy mismo.
      </p>

      <select v-model="motivo" class="select-input">
        <option :value="null">¿Por qué no se pudo entregar?</option>
        <option v-for="m in MOTIVOS" :key="m.valor" :value="m.valor">
          {{ m.etiqueta }}
        </option>
      </select>

      <textarea
        v-model="nota"
        class="form-textarea"
        rows="2"
        maxlength="500"
        placeholder="Qué pasó (opcional)"
      />

      <div class="modal-actions">
        <button type="button" class="btn-cancel" @click="emit('cerrar')">Volver</button>
        <button type="button" class="btn-primary" :disabled="!motivo || enviando" @click="guardar">
          Guardar el intento
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-texto {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.45;
}
</style>
