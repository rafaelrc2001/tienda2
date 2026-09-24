<script setup lang="ts">
/**
 * La prueba de entrega de un pedido: foto, hora, quién lo entregó y dónde.
 *
 * La usan el detalle de Rutas y la Bitácora de Operaciones y Finanzas, que es
 * donde se busca cuando un cliente dice que no le llegó.
 */
import { urlDeImagen } from '@/api/http'
import { fechaHora } from '@/utils/formato'
import type { EvidenciaEntrega } from '@/api/tipos'

defineProps<{ evidencia: EvidenciaEntrega }>()
</script>

<template>
  <div class="evidencia">
    <a
      v-if="evidencia.fotoId"
      :href="urlDeImagen(evidencia.fotoId)"
      target="_blank"
      rel="noopener"
      class="enlace-foto"
    >
      <img
        :src="urlDeImagen(evidencia.fotoId)"
        class="foto"
        alt="Foto de la entrega"
        loading="lazy"
      />
    </a>
    <div class="datos">
      <span class="titulo">Entregado {{ fechaHora(evidencia.creadoEn) }}</span>
      <span>🛵 {{ evidencia.repartidorNombre }}</span>
      <span v-if="!evidencia.fotoId">📷 Sin foto</span>
      <a
        v-if="evidencia.lat !== null && evidencia.lng !== null"
        :href="`https://www.google.com/maps?q=${evidencia.lat},${evidencia.lng}`"
        target="_blank"
        rel="noopener"
        class="enlace-mapa"
      >
        📍 Ver ubicación en el mapa
      </a>
      <span v-else>📍 Sin ubicación</span>
    </div>
  </div>
</template>

<style scoped>
.evidencia {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.enlace-foto {
  flex-shrink: 0;
}

.foto {
  display: block;
  width: 96px;
  height: 96px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  background: var(--white);
}

.datos {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}

.titulo {
  font-family: var(--font-heading);
  font-weight: 700;
  color: var(--ink);
}

.enlace-mapa {
  font-family: var(--font-heading);
  font-weight: 700;
  color: var(--terracotta-dark);
  text-decoration: none;
}
</style>
