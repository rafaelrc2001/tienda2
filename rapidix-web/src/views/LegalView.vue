<script setup lang="ts">
/**
 * Aviso de privacidad y términos y condiciones (HU-14).
 *
 * El carrito los enlaza junto a la casilla de aceptación. El texto legal lo
 * tiene que entregar el negocio: mientras no llegue, la página existe y lo
 * dice, en vez de inventar un contenido que tendría valor contractual.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const titulo = computed(() =>
  route.params.documento === 'privacidad' ? 'Aviso de privacidad' : 'Términos y condiciones',
)
</script>

<template>
  <div class="admin-placeholder">
    <div class="ico">📄</div>
    <p class="t">{{ titulo }}</p>
    <p class="s">El texto de este documento se publicará aquí en cuanto esté disponible.</p>
  </div>
</template>
