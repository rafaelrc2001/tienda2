<script setup lang="ts">
/**
 * «Pedido entregado»: el comprobante listo para mandarse por WhatsApp al
 * teléfono con el que se registró el cliente.
 *
 * Sale al entregar un pedido en el PDV. El mensaje ya va escrito —cliente,
 * fecha, productos, cantidades, precios y total— y el botón abre WhatsApp en
 * ese chat: solo falta pulsar enviar. Es un enlace que toca la persona, no un
 * `window.open` tras la petición: eso el navegador de la tableta lo bloquea.
 */
import { computed } from 'vue'
import { enlaceDeEntrega, mensajeDeEntrega } from '@/utils/whatsapp'
import type { Pedido } from '@/api/tipos'

const props = defineProps<{
  pedido: Pedido
  /** Solo si el pedido no trae el del cliente (el recién capturado en caja). */
  telefono?: string | null
}>()
const emit = defineEmits<{ cerrar: [] }>()

const mensaje = computed(() => mensajeDeEntrega(props.pedido))
const enlace = computed(() => enlaceDeEntrega(props.pedido, props.telefono))
</script>

<template>
  <div class="modal-overlay" @click.self="emit('cerrar')">
    <div class="modal-sheet" role="dialog" :aria-label="`Comprobante de ${pedido.folio}`">
      <div class="modal-handle" />
      <p class="modal-title">Pedido {{ pedido.folio }} entregado</p>

      <!-- Lo que va a recibir el cliente, tal cual. -->
      <pre class="mensaje">{{ mensaje }}</pre>

      <p v-if="!enlace" class="form-error">
        El cliente no tiene un teléfono válido registrado: no se puede abrir su WhatsApp.
      </p>

      <div class="modal-actions">
        <button type="button" class="btn-cancel" @click="emit('cerrar')">Cerrar</button>
        <a
          v-if="enlace"
          class="btn-primary whatsapp"
          :href="enlace"
          target="_blank"
          rel="noopener"
          @click="emit('cerrar')"
        >
          Enviar por WhatsApp
        </a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mensaje {
  margin: 0 0 12px;
  padding: 10px 12px;
  max-height: 46vh;
  overflow-y: auto;
  background: var(--cream);
  border: 1px solid var(--line);
  border-radius: 12px;
  font-family: var(--font-body);
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--ink);
  white-space: pre-wrap;
  word-break: break-word;
}

.whatsapp {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--verde-compra);
  text-decoration: none;
}
</style>
