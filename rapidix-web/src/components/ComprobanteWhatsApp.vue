<script setup lang="ts">
/**
 * «Pedido entregado»: el comprobante listo para mandarse por WhatsApp al
 * teléfono con el que se registró el cliente.
 *
 * Sale al entregar un pedido en el PDV. El mensaje ya va escrito —cliente,
 * fecha, productos, cantidades, precios y total— y el botón abre WhatsApp en
 * ese chat: solo falta pulsar enviar. Es un enlace que toca la persona, no un
 * `window.open` tras la petición: eso el navegador de la tableta lo bloquea.
 *
 * Mientras la tienda no tenga WhatsApp el envío es **simulado**: el botón no
 * abre nada, solo avisa a qué número habría salido. `VITE_WHATSAPP_REAL=true`
 * lo vuelve el enlace de verdad; como toda `VITE_*`, exige recompilar.
 */
import { computed } from 'vue'
import { useUiStore } from '@/stores/ui'
import { enlaceDeEntrega, mensajeDeEntrega, telefonoParaWhatsApp } from '@/utils/whatsapp'
import type { Pedido } from '@/api/tipos'

const ENVIO_REAL = import.meta.env.VITE_WHATSAPP_REAL === 'true'

const props = defineProps<{
  pedido: Pedido
  /** Solo si el pedido no trae el del cliente (el recién capturado en caja). */
  telefono?: string | null
}>()
const emit = defineEmits<{ cerrar: [] }>()

const mensaje = computed(() => mensajeDeEntrega(props.pedido))
const enlace = computed(() => enlaceDeEntrega(props.pedido, props.telefono))
const numero = computed(() =>
  telefonoParaWhatsApp(props.telefono ?? props.pedido.clienteTelefono),
)

const ui = useUiStore()

/** No sale ningún mensaje: se dice a quién habría ido, y que fue simulado. */
function simularEnvio(): void {
  ui.exito(`Comprobante enviado a +${numero.value} (simulado)`)
  emit('cerrar')
}
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
      <p v-else-if="!ENVIO_REAL" class="aviso-simulado">
        Envío simulado a +{{ numero }}: todavía no sale ningún WhatsApp.
      </p>

      <div class="modal-actions">
        <button type="button" class="btn-cancel" @click="emit('cerrar')">Cerrar</button>
        <button
          v-if="enlace && !ENVIO_REAL"
          type="button"
          class="btn-primary whatsapp"
          @click="simularEnvio"
        >
          Enviar por WhatsApp
        </button>
        <a
          v-else-if="enlace"
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

.aviso-simulado {
  margin: 0 0 12px;
  font-size: 11.5px;
  color: var(--muted);
}

.whatsapp {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--verde-compra);
  text-decoration: none;
}
</style>
