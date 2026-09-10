import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { decidir, inicioDe } from './guard'
import type { Seccion } from '@/api/tipos'

declare module 'vue-router' {
  interface RouteMeta {
    /** Ruta abierta sin sesión. Solo el login y el enlace de fuentes. */
    publica?: boolean
    /** Sección de `PERMISOS_POR_ROL` que exige la ruta. */
    seccion?: Seccion
    /** Rutas de la app de cliente: no las ve el personal del negocio. */
    soloCliente?: boolean
    /** Título de la barra superior. */
    titulo?: string
  }
}

/**
 * Mapa de rutas del SPEC 02 §3.3.
 *
 * Cada ruta bajo `/admin` declara en su `meta.seccion` una de las nueve
 * secciones de `PERMISOS_POR_ROL`; el guard de abajo comprueba que esa
 * sección esté en el menú que devolvió la API.
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { publica: true },
  },
  {
    /**
     * Enlace de una fuente de adquisición: `rapidix.mx/r/CODIGO`. Guarda el
     * código y sigue al login, que lo mandará en el alta.
     */
    path: '/r/:codigo',
    name: 'fuente',
    redirect: (destino) => {
      const codigo = destino.params.codigo
      return { path: '/login', query: { r: Array.isArray(codigo) ? codigo[0] : codigo } }
    },
    meta: { publica: true },
  },
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
    meta: { soloCliente: true, titulo: 'Rapidix' },
  },
  {
    /**
     * La Tienda se puede mirar sin sesión (HU-02): el visitante ve el catálogo
     * con el orden del negocio y arma su carrito; el login se le pide al pulsar
     * «Comprar ahora». `soloCliente` sigue puesto para que el personal del
     * negocio no acabe aquí con su token de staff.
     */
    path: '/tienda',
    name: 'tienda',
    component: () => import('@/views/TiendaView.vue'),
    meta: { publica: true, soloCliente: true, titulo: 'Tienda' },
  },
  {
    path: '/carrito',
    name: 'carrito',
    component: () => import('@/views/CarritoView.vue'),
    meta: { soloCliente: true, titulo: 'Mi carrito' },
  },
  {
    path: '/recetario',
    name: 'recetario',
    component: () => import('@/views/RecetarioView.vue'),
    meta: { soloCliente: true, titulo: 'Recetario' },
  },
  {
    path: '/recetario/:id',
    name: 'receta',
    component: () => import('@/views/RecetaDetalleView.vue'),
    meta: { soloCliente: true, titulo: 'Receta' },
  },
  {
    path: '/cupones',
    name: 'cupones',
    component: () => import('@/views/CuponesView.vue'),
    meta: { soloCliente: true, titulo: 'Mis Cupones' },
  },
  {
    path: '/destacados',
    name: 'destacados',
    component: () => import('@/views/DestacadosView.vue'),
    meta: { titulo: 'Destacados' },
  },
  {
    path: '/perfil',
    name: 'perfil',
    component: () => import('@/views/PerfilView.vue'),
    meta: { titulo: 'Mi Perfil' },
  },
  {
    path: '/perfil/pedidos',
    name: 'mis-pedidos',
    component: () => import('@/views/MisPedidosView.vue'),
    meta: { seccion: 'mis-pedidos', titulo: 'Mis Pedidos' },
  },
  {
    path: '/perfil/cashback',
    name: 'cashback',
    component: () => import('@/views/CashbackView.vue'),
    meta: { soloCliente: true, titulo: 'Estado de cuenta' },
  },
  {
    path: '/admin',
    name: 'admin',
    component: () => import('@/views/admin/AdminMenuView.vue'),
    meta: { titulo: 'Administración' },
  },
  {
    path: '/admin/productos',
    name: 'admin-productos',
    component: () => import('@/views/admin/AdminProductosView.vue'),
    meta: { seccion: 'productos', titulo: 'Productos' },
  },
  {
    path: '/admin/recetas',
    name: 'admin-recetas',
    component: () => import('@/views/admin/AdminRecetasView.vue'),
    meta: { seccion: 'recetas', titulo: 'Recetas' },
  },
  {
    path: '/admin/configuracion',
    name: 'admin-configuracion',
    component: () => import('@/views/admin/AdminConfiguracionView.vue'),
    meta: { seccion: 'configuracion', titulo: 'Configuración' },
  },
  {
    path: '/admin/configuracion/horario',
    name: 'config-horario',
    component: () => import('@/views/admin/ConfigHorarioView.vue'),
    meta: { seccion: 'configuracion', titulo: 'Horario de servicio' },
  },
  {
    path: '/admin/configuracion/parametros',
    name: 'config-parametros',
    component: () => import('@/views/admin/ConfigParametrosView.vue'),
    meta: { seccion: 'configuracion', titulo: 'Parámetros del negocio' },
  },
  {
    path: '/admin/configuracion/bancarios',
    name: 'config-bancarios',
    component: () => import('@/views/admin/ConfigBancariosView.vue'),
    meta: { seccion: 'configuracion', titulo: 'Datos bancarios' },
  },
  {
    path: '/admin/configuracion/noticias',
    name: 'config-noticias',
    component: () => import('@/views/admin/ConfigNoticiasView.vue'),
    meta: { seccion: 'configuracion', titulo: 'Noticias y avisos' },
  },
  {
    path: '/admin/configuracion/niveles',
    name: 'config-niveles',
    component: () => import('@/views/admin/ConfigNivelesView.vue'),
    meta: { seccion: 'configuracion', titulo: 'Niveles de fidelidad' },
  },
  {
    path: '/admin/cupones',
    name: 'admin-cupones',
    component: () => import('@/views/admin/AdminCuponesView.vue'),
    meta: { seccion: 'configuracion', titulo: 'Cupones' },
  },
  {
    path: '/admin/cupones/ciclo-vida',
    name: 'cupones-ciclo-vida',
    component: () => import('@/views/admin/CuponesCicloVidaView.vue'),
    meta: { seccion: 'configuracion', titulo: 'Cupones · Ciclo de vida' },
  },
  {
    path: '/admin/cupones/campanias',
    name: 'cupones-campanias',
    component: () => import('@/views/admin/CuponesCampaniasView.vue'),
    meta: { seccion: 'configuracion', titulo: 'Cupones · Campañas' },
  },
  {
    path: '/admin/cupones/fuentes',
    name: 'cupones-fuentes',
    component: () => import('@/views/admin/CuponesFuentesView.vue'),
    meta: { seccion: 'configuracion', titulo: 'Cupones · Fuentes' },
  },
  {
    path: '/admin/cupones/metricas',
    name: 'cupones-metricas',
    component: () => import('@/views/admin/CuponesMetricasView.vue'),
    meta: { seccion: 'configuracion', titulo: 'Cupones · Métricas' },
  },
  {
    path: '/admin/clientes',
    name: 'admin-clientes',
    component: () => import('@/views/admin/AdminClientesView.vue'),
    meta: { seccion: 'clientes', titulo: 'Clientes' },
  },
  {
    path: '/admin/pedidos',
    name: 'admin-pedidos',
    component: () => import('@/views/admin/AdminPedidosView.vue'),
    meta: { seccion: 'mis-pedidos', titulo: 'Pedidos' },
  },
  // Rutas, Operaciones y Finanzas comparten vista: la API devuelve 501.
  {
    path: '/admin/rutas',
    name: 'admin-rutas',
    component: () => import('@/views/admin/SeccionPendienteView.vue'),
    meta: { seccion: 'rutas', titulo: 'Rutas' },
  },
  {
    path: '/admin/operaciones',
    name: 'admin-operaciones',
    component: () => import('@/views/admin/SeccionPendienteView.vue'),
    meta: { seccion: 'operaciones', titulo: 'Operaciones' },
  },
  {
    path: '/admin/finanzas',
    name: 'admin-finanzas',
    component: () => import('@/views/admin/SeccionPendienteView.vue'),
    meta: { seccion: 'finanzas', titulo: 'Finanzas' },
  },
  {
    path: '/:resto(.*)*',
    name: 'no-encontrada',
    component: () => import('@/views/NoEncontradaView.vue'),
    meta: { titulo: 'Rapidix' },
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

/**
 * Guard de sesión y de secciones.
 *
 * La interfaz **no lleva su propia copia de `PERMISOS_POR_ROL`**: comprueba
 * que la sección de `meta.seccion` esté en el menú que devolvió
 * `GET /admin/menu`. Un 403 del backend no debería llegar a verse nunca.
 */
router.beforeEach(async (destino) => {
  const auth = useAuthStore()

  // El arranque revalida el token guardado contra GET /auth/yo.
  if (!auth.listo) await auth.arrancar()

  const decision = decidir(
    {
      fullPath: destino.fullPath,
      nombre: typeof destino.name === 'string' ? destino.name : undefined,
      publica: destino.meta.publica,
      seccion: destino.meta.seccion,
      soloCliente: destino.meta.soloCliente,
    },
    {
      autenticado: auth.autenticado,
      esCliente: auth.esCliente,
      secciones: auth.secciones,
    },
  )

  if (decision.tipo === 'permitir') return true

  // El motivo se enseña con el mismo mensaje que daría la API.
  if (decision.motivo) useUiStore().error(decision.motivo)
  return { path: decision.a, query: decision.query }
})

export { inicioDe }
