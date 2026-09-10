import { describe, expect, it } from 'vitest'
import { decidir, inicioDe, type SesionGuard } from './guard'
import type { Seccion } from '@/api/tipos'

/** Menú que devolvería `GET /admin/menu` para cada rol (PERMISOS_POR_ROL). */
const MENU_ADMIN: Seccion[] = [
  'productos',
  'recetas',
  'configuracion',
  'operaciones',
  'rutas',
  'finanzas',
  'mis-pedidos',
  'clientes',
]
const MENU_RUTA: Seccion[] = ['rutas']
const MENU_FINANZAS: Seccion[] = ['finanzas', 'clientes']
const MENU_CLIENTE: Seccion[] = ['mis-pedidos']

const sinSesion: SesionGuard = { autenticado: false, esCliente: false, secciones: [] }
const comoAdmin: SesionGuard = { autenticado: true, esCliente: false, secciones: MENU_ADMIN }
const comoRuta: SesionGuard = { autenticado: true, esCliente: false, secciones: MENU_RUTA }
const comoFinanzas: SesionGuard = { autenticado: true, esCliente: false, secciones: MENU_FINANZAS }
const comoCliente: SesionGuard = { autenticado: true, esCliente: true, secciones: MENU_CLIENTE }

describe('inicioDe', () => {
  it('manda al cliente a la app y al personal al panel', () => {
    expect(inicioDe(true)).toBe('/')
    expect(inicioDe(false)).toBe('/admin')
  })
})

describe('decidir', () => {
  describe('sin sesión', () => {
    it('deja pasar a las rutas públicas', () => {
      const decision = decidir({ fullPath: '/login', nombre: 'login', publica: true }, sinSesion)
      expect(decision).toEqual({ tipo: 'permitir' })
    })

    /** Borrar el token y hacer cualquier acción acaba en el login, no en blanco. */
    it('manda al login conservando el destino', () => {
      const decision = decidir({ fullPath: '/admin/productos', seccion: 'productos' }, sinSesion)

      expect(decision).toEqual({
        tipo: 'redirigir',
        a: '/login',
        query: { destino: '/admin/productos' },
      })
    })
  })

  describe('con sesión abierta', () => {
    it('saca del login a quien ya entró', () => {
      expect(decidir({ fullPath: '/login', nombre: 'login', publica: true }, comoCliente)).toEqual({
        tipo: 'redirigir',
        a: '/',
      })
      expect(decidir({ fullPath: '/login', nombre: 'login', publica: true }, comoAdmin)).toEqual({
        tipo: 'redirigir',
        a: '/admin',
      })
    })

    it('deja pasar al enlace de fuente aunque haya sesión', () => {
      const decision = decidir({ fullPath: '/r/IG05', nombre: 'fuente', publica: true }, comoAdmin)
      expect(decision).toEqual({ tipo: 'permitir' })
    })
  })

  describe('rutas de la app de cliente', () => {
    it('deja entrar al cliente', () => {
      expect(decidir({ fullPath: '/tienda', soloCliente: true }, comoCliente)).toEqual({
        tipo: 'permitir',
      })
    })

    it('desvía al personal del negocio al panel', () => {
      expect(decidir({ fullPath: '/tienda', soloCliente: true }, comoAdmin)).toEqual({
        tipo: 'redirigir',
        a: '/admin',
      })
    })

    /**
     * HU-02: la Tienda se mira sin sesión. Que sea pública no la abre al
     * personal del negocio, que tiene su propio panel.
     */
    it('deja mirar la Tienda sin sesión pero no al personal', () => {
      const tienda = { fullPath: '/tienda', publica: true, soloCliente: true }

      expect(decidir(tienda, sinSesion)).toEqual({ tipo: 'permitir' })
      expect(decidir(tienda, comoCliente)).toEqual({ tipo: 'permitir' })
      expect(decidir(tienda, comoAdmin)).toEqual({ tipo: 'redirigir', a: '/admin' })
    })
  })

  describe('secciones del panel', () => {
    /** El criterio de aceptación: RUTA escribiendo /admin/productos a mano. */
    it('devuelve al menú a un rol sin acceso, con su motivo', () => {
      const decision = decidir({ fullPath: '/admin/productos', seccion: 'productos' }, comoRuta)

      expect(decision).toEqual({
        tipo: 'redirigir',
        a: '/admin',
        motivo: 'Tu rol no tiene acceso a esta sección.',
      })
    })

    it('deja entrar al rol que sí tiene la sección', () => {
      expect(decidir({ fullPath: '/admin/rutas', seccion: 'rutas' }, comoRuta)).toEqual({
        tipo: 'permitir',
      })
      expect(decidir({ fullPath: '/admin/productos', seccion: 'productos' }, comoAdmin)).toEqual({
        tipo: 'permitir',
      })
    })

    /** ADMINISTRADOR y FINANZAS son los dos roles con `clientes`. */
    it('respeta que Clientes lo vean administración y finanzas', () => {
      expect(decidir({ fullPath: '/admin/clientes', seccion: 'clientes' }, comoFinanzas)).toEqual({
        tipo: 'permitir',
      })
      expect(decidir({ fullPath: '/admin/clientes', seccion: 'clientes' }, comoAdmin)).toEqual({
        tipo: 'permitir',
      })
      expect(decidir({ fullPath: '/admin/clientes', seccion: 'clientes' }, comoRuta).tipo).toBe(
        'redirigir',
      )
    })

    it('deja al cliente entrar solo a Mis Pedidos', () => {
      expect(
        decidir({ fullPath: '/perfil/pedidos', seccion: 'mis-pedidos' }, comoCliente),
      ).toEqual({ tipo: 'permitir' })

      expect(
        decidir({ fullPath: '/admin/productos', seccion: 'productos' }, comoCliente).tipo,
      ).toBe('redirigir')
    })

    it('deja pasar una ruta autenticada que no exige sección', () => {
      expect(decidir({ fullPath: '/perfil' }, comoCliente)).toEqual({ tipo: 'permitir' })
      expect(decidir({ fullPath: '/admin' }, comoRuta)).toEqual({ tipo: 'permitir' })
    })

    /**
     * Si el menú no llegó a cargarse, ninguna sección está disponible: se
     * vuelve al menú en vez de dejar pasar por defecto.
     */
    it('bloquea las secciones cuando el menú viene vacío', () => {
      const sinMenu: SesionGuard = { autenticado: true, esCliente: false, secciones: [] }
      expect(decidir({ fullPath: '/admin/productos', seccion: 'productos' }, sinMenu).tipo).toBe(
        'redirigir',
      )
    })
  })
})
