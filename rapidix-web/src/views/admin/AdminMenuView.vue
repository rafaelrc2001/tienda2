<script setup lang="ts">
/**
 * Menú del panel de administración.
 *
 * Se arma con lo que devuelve `GET /admin/menu`, igual que el drawer: la
 * interfaz no lleva su propia copia de `PERMISOS_POR_ROL`.
 */
import { useAuthStore } from '@/stores/auth'
import { RUTA_POR_SECCION } from '@/router/secciones'

const auth = useAuthStore()
</script>

<template>
  <div class="menu">
    <p class="saludo">Hola, {{ auth.usuario?.nombre }}</p>
    <p class="rol">{{ auth.usuario?.rol }}</p>

    <RouterLink
      v-for="item in auth.menu"
      :key="item.seccion"
      :to="RUTA_POR_SECCION[item.seccion]"
      class="admin-menu-item"
    >
      <span class="ico">{{ item.icono }}</span>
      <span class="txt">
        <span class="t">{{ item.titulo }}</span>
        <span class="s">{{ item.descripcion }}</span>
      </span>
      <span class="chev">›</span>
    </RouterLink>

    <p v-if="auth.menu.length === 0" class="empty-block">
      No pudimos cargar tu menú. Vuelve a entrar.
    </p>
  </div>
</template>

<style scoped>
.menu {
  padding: 16px 18px 24px;
}

.saludo {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 18px;
  color: var(--ink);
  margin: 0;
}

.rol {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 3px 0 18px;
}

.admin-menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--white);
  border: 1.5px solid var(--line);
  border-radius: 14px;
  padding: 13px 14px;
  margin-bottom: 10px;
  text-decoration: none;
}

.admin-menu-item .ico {
  font-size: 22px;
  width: 36px;
  height: 36px;
  background: var(--cream);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: var(--shadow);
}

.admin-menu-item .txt {
  flex: 1;
  min-width: 0;
}

.admin-menu-item .t {
  display: block;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13.5px;
  color: var(--ink);
}

.admin-menu-item .s {
  display: block;
  font-size: 11px;
  color: var(--muted);
  margin-top: 2px;
  line-height: 1.3;
}

.admin-menu-item .chev {
  font-size: 18px;
  color: var(--muted);
  flex-shrink: 0;
}
</style>
