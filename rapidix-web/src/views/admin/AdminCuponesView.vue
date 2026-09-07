<script setup lang="ts">
/**
 * Administración → Configuración → Cupones: submenú de las cuatro pantallas
 * del motor (Word 4.9).
 */
const PANTALLAS = [
  {
    ruta: '/admin/cupones/ciclo-vida',
    ico: '🔁',
    titulo: 'Ciclo de vida',
    desc: 'Los cinco tipos automáticos y sus parámetros',
  },
  {
    ruta: '/admin/cupones/campanias',
    ico: '🎯',
    titulo: 'Campañas',
    desc: 'Promociones dirigidas con constructor de segmentos',
  },
  {
    ruta: '/admin/cupones/fuentes',
    ico: '🔗',
    titulo: 'Fuentes de adquisición',
    desc: 'Enlaces rapidix.mx/r/CODIGO y su atribución',
  },
  {
    ruta: '/admin/cupones/metricas',
    ico: '📊',
    titulo: 'Métricas',
    desc: 'Generados, utilizados y porcentaje de utilización',
  },
]
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin/configuracion" class="admin-back-inline">
      ← Volver a Configuración
    </RouterLink>

    <RouterLink
      v-for="p in PANTALLAS"
      :key="p.ruta"
      :to="p.ruta"
      class="admin-menu-item"
    >
      <span class="ico">{{ p.ico }}</span>
      <span class="txt">
        <span class="t">{{ p.titulo }}</span>
        <span class="s">{{ p.desc }}</span>
      </span>
      <span class="chev">›</span>
    </RouterLink>
  </div>
</template>

<style scoped>
.pantalla {
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
