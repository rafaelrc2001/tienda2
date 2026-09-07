import type { Seccion } from '@/api/tipos'

/**
 * Dónde vive cada sección del menú dentro del mapa de rutas (SPEC 02 §3.3).
 *
 * Dos de ellas no cuelgan de `/admin`, porque son del cliente: "Mis Pedidos"
 * está dentro del Perfil y "Mis Cupones" en la barra inferior.
 */
export const RUTA_POR_SECCION: Record<Seccion, string> = {
  productos: '/admin/productos',
  recetas: '/admin/recetas',
  configuracion: '/admin/configuracion',
  operaciones: '/admin/operaciones',
  rutas: '/admin/rutas',
  finanzas: '/admin/finanzas',
  'mis-pedidos': '/perfil/pedidos',
  'mis-cupones': '/cupones',
  clientes: '/admin/clientes',
}
