import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './assets/base.css'
import App from './App.vue'
import { router } from './router'
import { registrarSesionExpirada } from './api/http'
import { useAuthStore } from './stores/auth'
import { useUiStore } from './stores/ui'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

/**
 * Qué pasa cuando la API responde 401.
 *
 * Se registra aquí y no dentro de `http.ts` para que la capa HTTP no dependa
 * ni del router ni de los stores. Borrar el token a mano y hacer cualquier
 * acción acaba en el login con un aviso, nunca en una pantalla en blanco.
 */
registrarSesionExpirada(() => {
  const auth = useAuthStore(pinia)
  if (!auth.token && !auth.usuario) return

  auth.cerrarSesion()
  useUiStore(pinia).error('Tu sesión expiró. Vuelve a entrar.')
  void router.replace({ path: '/login', query: { destino: router.currentRoute.value.fullPath } })
})

app.mount('#app')
