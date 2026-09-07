<script setup lang="ts">
/**
 * Administración → Configuración: submenú de las cinco pantallas.
 */
const PANTALLAS = [
  {
    ruta: '/admin/configuracion/horario',
    ico: '🕒',
    titulo: 'Horario de servicio',
    desc: 'Días, horas y atención fuera de horario',
  },
  {
    ruta: '/admin/configuracion/parametros',
    ico: '⚖️',
    titulo: 'Parámetros del negocio',
    desc: 'Envío, envío gratis y cashback',
  },
  {
    ruta: '/admin/configuracion/bancarios',
    ico: '🏦',
    titulo: 'Datos bancarios',
    desc: 'Banco, beneficiario y número de cuenta',
  },
  {
    ruta: '/admin/configuracion/noticias',
    ico: '📣',
    titulo: 'Noticias y avisos',
    desc: 'Lo que ven los clientes en Destacados',
  },
  {
    ruta: '/admin/configuracion/niveles',
    ico: '🏅',
    titulo: 'Niveles de fidelidad',
    desc: 'Escalera de niveles y sus umbrales',
  },
  {
    ruta: '/admin/cupones',
    ico: '🎟️',
    titulo: 'Cupones',
    desc: 'Ciclo de vida, campañas, fuentes y métricas',
  },
]
</script>

<template>
  <div class="config">
    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <RouterLink
      v-for="pantalla in PANTALLAS"
      :key="pantalla.ruta"
      :to="pantalla.ruta"
      class="admin-menu-item"
    >
      <span class="ico">{{ pantalla.ico }}</span>
      <span class="txt">
        <span class="t">{{ pantalla.titulo }}</span>
        <span class="s">{{ pantalla.desc }}</span>
      </span>
      <span class="chev">›</span>
    </RouterLink>
  </div>
</template>

<style scoped>
.config {
  padding: 12px 18px 24px;
}

.admin-back-inline {
  display: inline-block;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  padding: 0 0 14px;
  text-decoration: none;
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
