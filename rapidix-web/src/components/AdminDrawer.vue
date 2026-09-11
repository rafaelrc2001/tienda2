<script setup lang="ts">
/**
 * Drawer del panel de administración.
 *
 * Se construye **entero** con lo que devuelve `GET /admin/menu`: la interfaz
 * no lleva su propia copia de la matriz de permisos. Un cliente ve ahí solo
 * "Mis Pedidos", que es lo que le da `PERMISOS_POR_ROL`.
 */
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { RUTA_POR_SECCION } from '@/router/secciones'
import type { Seccion } from '@/api/tipos'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()

async function ir(seccion: Seccion): Promise<void> {
  ui.cerrarDrawer()
  await router.push(RUTA_POR_SECCION[seccion])
}

async function salir(): Promise<void> {
  ui.cerrarDrawer()
  auth.cerrarSesion()
  await router.replace('/login')
}

/**
 * Vuelve a la pantalla donde se elige con qué modo entrar.
 *
 * El rol va dentro del JWT, así que cambiarlo obliga a pedir un token nuevo:
 * por debajo es cerrar sesión y volver al login, que con el acceso directo
 * encendido son dos toques.
 */
async function cambiarDeModo(): Promise<void> {
  await salir()
}
</script>

<template>
  <Transition name="drawer">
    <div v-if="ui.drawerAbierto" class="drawer-overlay" @click.self="ui.cerrarDrawer()">
      <aside class="drawer" role="dialog" aria-label="Menú de administración">
        <header class="drawer-cabecera">
          <div>
            <p class="drawer-titulo">{{ auth.usuario?.nombre }}</p>
            <p class="drawer-rol">{{ auth.usuario?.rol }}</p>
          </div>
          <button type="button" class="close-x" aria-label="Cerrar" @click="ui.cerrarDrawer()">
            ✕
          </button>
        </header>

        <nav class="drawer-lista">
          <button
            v-for="item in auth.menu"
            :key="item.seccion"
            type="button"
            class="admin-menu-item"
            @click="ir(item.seccion)"
          >
            <span class="ico">{{ item.icono }}</span>
            <span class="txt">
              <span class="t">{{ item.titulo }}</span>
              <span class="s">{{ item.descripcion }}</span>
            </span>
            <span class="chev">›</span>
          </button>

          <p v-if="auth.menu.length === 0" class="empty-block">
            No pudimos cargar tu menú. Vuelve a entrar.
          </p>
        </nav>

        <footer class="drawer-pie">
          <RouterLink to="/perfil" class="btn-secondary ancho" @click="ui.cerrarDrawer()">
            Mi perfil
          </RouterLink>
          <!--
            Cambiar de modo devuelve a la pantalla de selección de rol. Es la
            misma salida que "Cerrar sesión" —el rol viaja en el token, así que
            no hay forma de cambiarlo sin pedir otro—, pero dicha con el nombre
            de lo que el usuario quiere hacer.
          -->
          <button type="button" class="btn-secondary ancho" @click="cambiarDeModo">
            Cambiar de modo
          </button>
          <button type="button" class="btn-cancel" @click="salir">Cerrar sesión</button>
        </footer>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 120;
  display: flex;
  justify-content: flex-start;
}

.drawer {
  width: min(320px, 88vw);
  background: var(--cream);
  height: 100%;
  display: flex;
  flex-direction: column;
  box-shadow: 0 0 40px rgba(0, 0, 0, 0.4);
}

.drawer-cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 18px 14px;
  border-bottom: 1px solid var(--line);
}

.drawer-titulo {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 15px;
  color: var(--ink);
  margin: 0;
}

.drawer-rol {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 3px 0 0;
}

.drawer-lista {
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px 8px;
}

.admin-menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  background: var(--white);
  border: 1.5px solid var(--line);
  border-radius: 14px;
  padding: 13px 14px;
  margin-bottom: 10px;
  cursor: pointer;
  font-family: inherit;
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

.drawer-pie {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 18px 20px;
  border-top: 1px solid var(--line);
}

.ancho {
  width: 100%;
  text-decoration: none;
  display: block;
}

.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.2s ease;
}

.drawer-enter-active .drawer,
.drawer-leave-active .drawer {
  transition: transform 0.22s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-from .drawer,
.drawer-leave-to .drawer {
  transform: translateX(-100%);
}
</style>
