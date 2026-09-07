<script setup lang="ts">
/**
 * Ruta que no existe.
 *
 * Adónde vuelve depende de quién mire: un cliente a su inicio, el personal
 * del negocio al menú del panel.
 */
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
</script>

<template>
  <div class="admin-placeholder">
    <div class="ico">🧭</div>
    <p class="t">Esta página no existe</p>
    <p class="s">Puede que el enlace esté mal escrito o que la pantalla se haya movido.</p>
    <RouterLink :to="auth.esCliente ? '/' : '/admin'" class="btn-primary volver">
      {{ auth.esCliente ? 'Volver al inicio' : 'Volver al menú' }}
    </RouterLink>
  </div>
</template>

<style scoped>
.volver {
  display: inline-block;
  text-decoration: none;
  margin-top: 4px;
}
</style>
