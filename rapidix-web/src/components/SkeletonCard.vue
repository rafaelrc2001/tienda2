<script setup lang="ts">
/**
 * Silueta de la tarjeta de producto de la Tienda, en rejilla de dos columnas.
 *
 * Las medidas son las de `.product-card` del mockup para que la pantalla no
 * dé un salto cuando llegan los datos.
 */
withDefaults(defineProps<{ cantidad?: number }>(), { cantidad: 6 })
</script>

<template>
  <div class="skeleton-grid" aria-hidden="true">
    <div v-for="n in cantidad" :key="n" class="skeleton-card">
      <div class="sk sk-media" />
      <div class="sk sk-linea sk-ancha" />
      <div class="sk sk-linea sk-corta" />
      <div class="sk sk-precio" />
    </div>
  </div>
</template>

<style scoped>
.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  padding: 0 18px 8px;
}

.skeleton-card {
  background: var(--white);
  border-radius: 16px;
  padding: 12px;
  box-shadow: var(--shadow);
}

.sk {
  background: var(--cream-2);
  border-radius: 6px;
  animation: latido 1.3s ease-in-out infinite;
}

.sk-media {
  height: 70px;
  border-radius: 12px;
  margin-bottom: 8px;
}

.sk-linea {
  height: 11px;
  margin-bottom: 6px;
}

.sk-ancha {
  width: 85%;
}

.sk-corta {
  width: 45%;
}

.sk-precio {
  height: 14px;
  width: 55%;
  margin-top: 8px;
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
