<script setup lang="ts">
/**
 * «Entregar» un pedido que se recoge en la tienda: antes de dar el paso se
 * dice cómo pagó el cliente en el mostrador.
 *
 * Al de crédito el pago es opcional: si no paga, queda a crédito y va a CXC
 * como siempre; si paga, se salda entero con el método elegido y su dinero
 * entra a la caja. Al de pago pendiente sí se le cobra, pero puede pagar con
 * otro método que el que eligió en la app.
 */
import { ref } from 'vue'
import { dinero } from '@/utils/formato'
import type { MetodoPago, PedidoEnPantalla } from '@/api/tipos'

const props = defineProps<{ pedido: PedidoEnPantalla; enviando: boolean }>()
/** `null`: no pagó y queda a crédito. */
const emit = defineEmits<{ cerrar: []; entregar: [cobro: MetodoPago | null] }>()

const aCredito = props.pedido.pago.estado === 'CREDITO'

type Opcion = MetodoPago | 'CREDITO'
const elegida = ref<Opcion>(aCredito ? 'CREDITO' : props.pedido.pago.metodo)

const OPCIONES: { valor: Opcion; texto: string; nota: string }[] = [
  ...(aCredito
    ? [{ valor: 'CREDITO' as const, texto: 'No paga ahora', nota: 'Queda a crédito, en CXC' }]
    : []),
  { valor: 'EFECTIVO', texto: 'Efectivo', nota: 'Entra a tu corte de caja' },
  { valor: 'TRANSFERENCIA', texto: 'Transferencia', nota: 'Ya la recibiste en la cuenta' },
]

function confirmar(): void {
  emit('entregar', elegida.value === 'CREDITO' ? null : elegida.value)
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('cerrar')">
    <div class="modal-sheet" role="dialog" :aria-label="`Entregar ${pedido.folio}`">
      <div class="modal-handle" />
      <p class="modal-title">Entregar {{ pedido.folio }}</p>

      <div class="a-cobrar">
        <span>{{ aCredito ? 'Debe' : 'A cobrar' }}</span>
        <strong>{{ dinero(pedido.pago.saldo) }}</strong>
      </div>

      <p class="subtitulo">{{ aCredito ? '¿Paga ahora?' : '¿Cómo pagó?' }}</p>
      <label v-for="o in OPCIONES" :key="o.valor" class="opcion">
        <input v-model="elegida" type="radio" name="cobro-entrega" :value="o.valor" />
        {{ o.texto }}
        <span class="nota-opcion">{{ o.nota }}</span>
      </label>

      <div class="modal-actions">
        <button type="button" class="btn-cancel" :disabled="enviando" @click="emit('cerrar')">
          Cancelar
        </button>
        <button type="button" class="btn-primary" :disabled="enviando" @click="confirmar">
          {{ enviando ? 'Entregando…' : 'Entregar' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.a-cobrar {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 10px 12px;
  background: var(--cream);
  border: 1px solid var(--line);
  border-radius: 12px;
  font-size: 13px;
  color: var(--ink);
}

.a-cobrar strong {
  font-family: var(--font-heading);
  font-size: 18px;
}

/* Las mismas opciones que «¿Cómo va a pagar?» en la caja. */
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
  font-size: 13px;
  color: var(--ink);
  padding: 9px 0;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
}

.opcion input {
  accent-color: var(--sage);
}

.nota-opcion {
  flex-basis: 100%;
  font-family: var(--font-body);
  font-weight: 400;
  font-size: 11px;
  color: var(--muted);
  padding-left: 22px;
}

.modal-actions {
  margin-top: 14px;
}
</style>
