<script setup lang="ts">
/**
 * Silueta de la tarjeta de receta del Recetario, apilada en lista.
 *
 * Sirve también para cualquier otra lista de filas con miniatura: cupones,
 * destacados, pedidos. Las medidas son las de `.recipe-card` del mockup.
 */
withDefaults(defineProps<{ cantidad?: number }>(), { cantidad: 4 })
</script>

<template>
  <div class="skeleton-list" aria-hidden="true">
    <div v-for="n in cantidad" :key="n" class="skeleton-fila">
      <div class="sk sk-miniatura" />
      <div class="sk-texto">
        <div class="sk sk-linea sk-ancha" />
        <div class="sk sk-linea sk-media" />
        <div class="sk sk-linea sk-corta" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.skeleton-list {
  padding: 0 18px;
}

.skeleton-fila {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  background: var(--white);
  border-radius: 18px;
  box-shadow: var(--shadow);
  padding: 14px;
  margin-bottom: 14px;
}

.sk {
  background: var(--cream-2);
  border-radius: 6px;
  animation: latido 1.3s ease-in-out infinite;
}

.sk-miniatura {
  width: 64px;
  height: 64px;
  border-radius: 14px;
  flex-shrink: 0;
}

.sk-texto {
  flex: 1;
  min-width: 0;
  padding-top: 4px;
}

.sk-linea {
  height: 11px;
  margin-bottom: 8px;
}

.sk-ancha {
  width: 80%;
}

.sk-media {
  width: 55%;
}

.sk-corta {
  width: 35%;
  margin-bottom: 0;
}

@keyframes latido {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sk {
    animation: none;
  }
}
</style>
