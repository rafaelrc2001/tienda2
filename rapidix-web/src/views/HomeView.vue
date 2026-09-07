<script setup lang="ts">
/**
 * Home del cliente (Word 4.1).
 *
 * Porta la pantalla del mockup: logo, foto de portada con su insignia,
 * saludo, botón de pedir, las tres categorías que llevan al Recetario ya
 * filtrado y la tira "Para ti hoy". Lo que el mockup simulaba con datos
 * locales aquí sale de la API.
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { http, ErrorApi } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { useDestacadosStore } from '@/stores/destacados'
import type { RecetaPausada } from '@/api/tipos'

const auth = useAuthStore()
const destacados = useDestacadosStore()
const router = useRouter()

const pausada = ref<RecetaPausada | null>(null)
const cargandoPausada = ref(true)
const quitando = ref(false)

const CATEGORIAS = [
  { clave: 'desayuno', emoji: '🥞', etiqueta: 'Desayuno' },
  { clave: 'comida', emoji: '🍗', etiqueta: 'Comida' },
  { clave: 'cena', emoji: '☕', etiqueta: 'Cena' },
] as const

onMounted(async () => {
  // Las dos llamadas son independientes: una que falle no debe dejar la otra
  // sin pintar.
  void cargarPausada()
  destacados.cargar().catch(() => {})
})

async function cargarPausada(): Promise<void> {
  cargandoPausada.value = true
  try {
    pausada.value = await http.get<RecetaPausada | null>('/recetario/pausada')
  } catch (fallo) {
    // El recetario bloqueado por inactividad se trata en su pantalla, no
    // aquí: el Home simplemente no enseña banner.
    if (!(fallo instanceof ErrorApi)) throw fallo
    pausada.value = null
  } finally {
    cargandoPausada.value = false
  }
}

async function continuarReceta(): Promise<void> {
  if (pausada.value) await router.push(`/recetario/${pausada.value.recetaId}`)
}

async function cancelarPausa(): Promise<void> {
  quitando.value = true
  try {
    await http.delete('/recetario/pausada')
    pausada.value = null
  } finally {
    quitando.value = false
  }
}

/** Las tres categorías llevan al Recetario ya filtrado, como en el mockup. */
function irAlRecetario(categoria: string): void {
  void router.push({ path: '/recetario', query: { categoria } })
}
</script>

<template>
  <div class="home">
    <header class="home-hero-header">
      <div class="logo-wrap">
        <div class="logo-bowl">
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M4 12h16M14 8l4 4-4 4"
              stroke="#FBF3E7"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        <div class="logo-text">RAPIDIX</div>
      </div>
    </header>

    <div class="hero-photo-wrap">
      <div class="hero-photo"><span class="plate">🍽️</span></div>
      <div class="hero-badge">TU COMIDA CASERA</div>
    </div>

    <!-- Banner de la receta en pausa: solo puede haber una a la vez. -->
    <div v-if="cargandoPausada" class="banner-skeleton" aria-hidden="true" />
    <div v-else-if="pausada" class="paused-banner">
      <div class="paused-banner-top">
        <span class="paused-emoji">
          <img v-if="pausada.imagenUrl" :src="pausada.imagenUrl" :alt="pausada.nombre" />
          <template v-else>{{ pausada.emoji ?? '🍲' }}</template>
        </span>
        <div>
          <p class="paused-label">Receta en pausa</p>
          <p class="paused-name">{{ pausada.nombre }}</p>
        </div>
      </div>
      <div class="paused-actions">
        <button type="button" class="btn-primary" @click="continuarReceta">Continuar</button>
        <button type="button" class="btn-cancel" :disabled="quitando" @click="cancelarPausa">
          Cancelar
        </button>
      </div>
    </div>

    <div class="greeting-row">
      <span class="greeting-hola">Hola, {{ auth.usuario?.nombre ?? 'qué gusto verte' }}</span>
    </div>

    <div class="order-btn-wrap">
      <RouterLink to="/tienda" class="order-btn">Realizar Pedido</RouterLink>
    </div>

    <p class="o-quieres">¿O quieres que te ayude con:?</p>
    <div class="cat-grid">
      <button
        v-for="categoria in CATEGORIAS"
        :key="categoria.clave"
        type="button"
        class="cat-item"
        @click="irAlRecetario(categoria.clave)"
      >
        <span class="cat-icon-circle">{{ categoria.emoji }}</span>
        <span class="cat-label">{{ categoria.etiqueta }}</span>
      </button>
    </div>

    <h2 class="section-title"><span class="accent-bar" />Para ti hoy</h2>

    <div v-if="destacados.cargando" class="promo-strip" aria-hidden="true">
      <div v-for="n in 2" :key="n" class="promo-mini promo-skeleton" />
    </div>
    <div v-else-if="destacados.noticias.length > 0" class="promo-strip">
      <RouterLink
        v-for="noticia in destacados.noticias.slice(0, 3)"
        :key="noticia.id"
        to="/destacados"
        class="promo-mini"
      >
        <span class="tag">{{ noticia.badge }}</span>
        <span class="txt">{{ noticia.titulo }}</span>
      </RouterLink>
    </div>
    <p v-else class="empty-block">Todavía no hay promociones. Vuelve pronto.</p>
  </div>
</template>

<style scoped>
.home-hero-header {
  background: var(--cream-2);
  padding: 6px 0 18px;
  text-align: center;
}

.logo-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 4px;
}

.logo-bowl {
  width: 78px;
  height: 52px;
  background: var(--terracotta);
  border-radius: 0 0 40px 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-bowl svg {
  width: 38px;
  height: 38px;
}

.logo-text {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 26px;
  color: var(--terracotta);
  letter-spacing: 0.03em;
  margin-top: 6px;
}

.hero-photo-wrap {
  margin: 14px 18px 0;
  border-radius: 18px;
  overflow: hidden;
  position: relative;
  box-shadow: var(--shadow);
}

.hero-photo {
  height: 180px;
  width: 100%;
  background: linear-gradient(160deg, #f7efe0, #e9dcc2 60%, #d8c6a0);
  display: flex;
  align-items: center;
  justify-content: center;
}

.hero-photo .plate {
  font-size: 80px;
  filter: drop-shadow(0 8px 10px rgba(0, 0, 0, 0.15));
}

.hero-badge {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  background: var(--gold);
  border: 2px solid var(--ink);
  border-radius: 12px;
  padding: 7px 18px;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  color: var(--ink);
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.banner-skeleton {
  margin: 14px 18px 4px;
  height: 118px;
  border-radius: 18px;
  background: var(--cream-2);
  animation: latido 1.3s ease-in-out infinite;
}

.paused-banner {
  margin: 14px 18px 4px;
  background: linear-gradient(135deg, #fff3dc, #fde6bc);
  border: 1.5px solid var(--gold-dark);
  border-radius: 18px;
  padding: 14px;
  box-shadow: var(--shadow);
}

.paused-banner-top {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.paused-emoji {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  background: var(--white);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  flex-shrink: 0;
  box-shadow: var(--shadow);
  overflow: hidden;
}

.paused-emoji img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.paused-label {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 10px;
  color: var(--terracotta-dark);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
}

.paused-name {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13.5px;
  color: var(--ink);
  margin: 2px 0 0;
}

.paused-actions {
  display: flex;
  gap: 8px;
}

.paused-actions .btn-primary,
.paused-actions .btn-cancel {
  flex: 1;
  font-size: 11.5px;
  padding: 10px 8px;
}

.greeting-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 20px 18px 4px;
}

.greeting-hola {
  font-family: var(--font-display);
  font-weight: 700;
  font-style: italic;
  color: var(--terracotta);
  font-size: 19px;
}

.order-btn-wrap {
  margin: 12px 18px 18px;
}

.order-btn {
  display: block;
  width: 100%;
  background: linear-gradient(180deg, #f5966b, #e9713d);
  color: var(--white);
  border: none;
  border-radius: 16px;
  padding: 13px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 14px;
  box-shadow: 0 6px 14px rgba(233, 113, 61, 0.3);
  cursor: pointer;
  text-align: center;
  text-decoration: none;
}

.o-quieres {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13px;
  margin: 16px 18px 8px;
  color: var(--ink);
}

.cat-grid {
  display: flex;
  justify-content: space-around;
  margin: 16px 10px 8px;
}

.cat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  background: none;
  border: none;
  width: 100px;
}

.cat-icon-circle {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--white);
  box-shadow: var(--shadow);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  transition: transform 0.15s ease;
}

.cat-item:active .cat-icon-circle {
  transform: scale(0.92);
}

.cat-label {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 11.5px;
  color: var(--ink);
}

.promo-strip {
  margin: 0 18px 6px;
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none;
}

.promo-strip::-webkit-scrollbar {
  display: none;
}

.promo-mini {
  flex-shrink: 0;
  width: 210px;
  border-radius: 16px;
  padding: 14px;
  background: var(--navy);
  color: var(--white);
  font-family: var(--font-heading);
  text-decoration: none;
  display: block;
}

.promo-mini .tag {
  display: block;
  font-size: 10px;
  font-weight: 700;
  color: var(--gold);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.promo-mini .txt {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-top: 4px;
  line-height: 1.3;
}

.promo-skeleton {
  height: 74px;
  background: var(--cream-2);
  animation: latido 1.3s ease-in-out infinite;
}

@keyframes latido {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

@media (prefers-reduced-motion: reduce) {
  .banner-skeleton,
  .promo-skeleton {
    animation: none;
  }
}
</style>
