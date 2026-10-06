<script setup lang="ts">
/**
 * Pinta la cola de toasts del store `ui`.
 *
 * Va en el slot `overlay` del layout. El mockup lo posicionaba dentro del
 * marco del teléfono; aquí va fijo sobre la columna, encima de la barra
 * inferior.
 *
 * No recibe toques: se va solo a los pocos segundos. Queda a la altura de los
 * botones de las hojas de confirmación, y cuando cerraba al tocarlo se tragaba
 * el toque que iba para el botón de debajo: había que pulsar dos veces.
 */
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
</script>

<template>
  <div class="toast-host" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="toast">
      <p v-for="toast in ui.toasts" :key="toast.id" class="toast" :class="`is-${toast.tipo}`">
        {{ toast.mensaje }}
      </p>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  bottom: 110px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: max-content;
  max-width: min(92vw, var(--ancho-cliente));
  pointer-events: none;
}

.toast {
  margin: 0;
  background: var(--ink);
  color: var(--white);
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 12.5px;
  padding: 10px 18px;
  border-radius: 12px;
  text-align: center;
  /* El mensaje de la API puede ser largo: se envuelve, no se desborda. */
  max-width: 100%;
  line-height: 1.4;
}

.toast.is-exito {
  background: var(--sage);
}

.toast.is-error {
  background: var(--terracotta);
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
