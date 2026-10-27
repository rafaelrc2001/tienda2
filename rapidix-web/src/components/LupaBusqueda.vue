<script setup lang="ts">
/**
 * La lupa de las listas de pedidos: un botón en el extremo derecho de la barra
 * naranja (frente a la hamburguesa) que abre el campo de búsqueda donde se
 * ponga el componente. Cerrarla deja el campo en blanco y la lista entera.
 *
 * Solo captura lo escrito (`v-model`); filtrar es cosa de la pantalla, con
 * `filtrarPorTexto` de `utils/busqueda`.
 */
import { nextTick, ref } from 'vue'

defineProps<{
  /** Para el lector de pantalla y el `title`: «Buscar pedidos». */
  etiqueta: string
  placeholder: string
}>()

const consulta = defineModel<string>({ required: true })

const abierta = ref(false)
const campo = ref<HTMLInputElement | null>(null)

async function alternar(): Promise<void> {
  abierta.value = !abierta.value
  consulta.value = ''
  if (!abierta.value) return
  await nextTick()
  campo.value?.focus()
}
</script>

<template>
  <Teleport defer to="#topbar-acciones">
    <button
      type="button"
      class="lupa"
      :class="{ activa: abierta }"
      :aria-pressed="abierta"
      :title="abierta ? 'Cerrar la búsqueda' : etiqueta"
      :aria-label="etiqueta"
      @click="alternar"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </button>
  </Teleport>

  <!-- Bloque crema y campo blanco: se ve dónde se escribe. -->
  <div v-if="abierta" class="busqueda">
    <input
      ref="campo"
      v-model="consulta"
      class="form-input"
      type="search"
      autocomplete="off"
      enterkeyhint="search"
      :placeholder="placeholder"
      :aria-label="etiqueta"
    />
  </div>
</template>

<style scoped>
/* Va sobre la barra naranja: blanca, y rellena cuando está abierta. */
.lupa {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1.5px solid transparent;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--white);
  cursor: pointer;
}

.lupa.activa {
  background: var(--white);
  color: var(--orange-dark);
}

.busqueda {
  flex-shrink: 0;
  margin: 0 0 12px;
  padding: 8px 10px;
  background: var(--cream-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
}

/* 16px reales: con menos, Safari en iPhone amplía la página al enfocar el campo. */
.busqueda .form-input {
  margin: 0;
  font-size: 16px;
  background: var(--white);
}
</style>
