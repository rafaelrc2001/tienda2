<script setup lang="ts">
/**
 * Mi Perfil (Word 4.7).
 *
 * Datos personales, quién recibe, dirección con mapa, notificaciones, tarjeta
 * de cashback y accesos a Mis Pedidos y al estado de cuenta.
 *
 * `telefono` se muestra pero no se edita: es la identidad de login y mandarlo
 * en el `PATCH` daría 400 por `forbidNonWhitelisted`.
 */
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ErrorApi, http } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { dinero } from '@/utils/formato'
/*
 * Leaflet pesa más que todo el resto del perfil junto. Se carga aparte para
 * que el formulario se pueda usar sin esperar al mapa.
 */
const MapaDireccion = defineAsyncComponent(() => import('@/components/MapaDireccion.vue'))
import type { ActualizarPerfil, EstadoCashback, Perfil } from '@/api/tipos'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()

const CAMPOS = [
  'nombre',
  'email',
  'fechaNacimiento',
  'quienRecibe',
  'sucursal',
  'calle',
  'colonia',
  'cp',
  'ciudad',
  'estado',
  'referencias',
  'lat',
  'lng',
] as const

const perfil = ref<Perfil | null>(null)
const cashback = ref<EstadoCashback | null>(null)
const cargando = ref(true)
const guardando = ref(false)
const errores = ref<Record<string, string>>({})
const erroresGenerales = ref<string[]>([])

/** Copia editable: el perfil original se conserva para no perderlo si falla. */
const formulario = ref<ActualizarPerfil>({})
const lat = ref<number | null>(null)
const lng = ref<number | null>(null)

/** `fechaNacimiento` llega en ISO completo y el `<input type="date">` quiere `YYYY-MM-DD`. */
const fechaNacimiento = computed({
  get: () => formulario.value.fechaNacimiento?.slice(0, 10) ?? '',
  set: (valor: string) => {
    formulario.value.fechaNacimiento = valor || undefined
  },
})

onMounted(async () => {
  try {
    perfil.value = await http.get<Perfil>('/perfil')
    volcarAlFormulario(perfil.value)
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }

  // El cashback es informativo: si falla, el perfil se sigue pudiendo editar.
  try {
    cashback.value = await http.get<EstadoCashback>('/perfil/cashback')
  } catch {
    cashback.value = null
  }
})

function volcarAlFormulario(datos: Perfil): void {
  formulario.value = {
    nombre: datos.nombre,
    email: datos.email ?? undefined,
    fechaNacimiento: datos.fechaNacimiento ?? undefined,
    quienRecibe: datos.quienRecibe ?? undefined,
    sucursal: datos.sucursal ?? undefined,
    calle: datos.direccion.calle ?? undefined,
    colonia: datos.direccion.colonia ?? undefined,
    cp: datos.direccion.cp ?? undefined,
    ciudad: datos.direccion.ciudad ?? undefined,
    estado: datos.direccion.estado ?? undefined,
    referencias: datos.direccion.referencias ?? undefined,
    notificaciones: datos.notificaciones,
  }
  lat.value = datos.direccion.lat
  lng.value = datos.direccion.lng
}

function fijarCoordenadas(coordenadas: { lat: number; lng: number }): void {
  lat.value = coordenadas.lat
  lng.value = coordenadas.lng
}

/** Manda solo lo que tiene valor: un campo vacío no se envía como cadena. */
function cuerpoDelPatch(): ActualizarPerfil {
  const cuerpo: ActualizarPerfil = {}
  for (const [clave, valor] of Object.entries(formulario.value)) {
    if (valor === undefined || valor === '') continue
    Object.assign(cuerpo, { [clave]: valor })
  }
  if (formulario.value.notificaciones !== undefined) {
    cuerpo.notificaciones = formulario.value.notificaciones
  }
  if (lat.value !== null) cuerpo.lat = lat.value
  if (lng.value !== null) cuerpo.lng = lng.value
  return cuerpo
}

async function guardar(): Promise<void> {
  guardando.value = true
  errores.value = {}
  erroresGenerales.value = []
  try {
    perfil.value = await http.patch<Perfil>('/perfil', cuerpoDelPatch())
    volcarAlFormulario(perfil.value)
    ui.exito('Perfil guardado')
  } catch (fallo) {
    if (fallo instanceof ErrorApi) {
      const { campos, generales } = fallo.porCampo(CAMPOS)
      errores.value = campos
      erroresGenerales.value = generales.length > 0 ? generales : [fallo.message]
    } else {
      ui.errorDeApi(fallo)
    }
  } finally {
    guardando.value = false
  }
}

async function salir(): Promise<void> {
  auth.cerrarSesion()
  await router.replace('/login')
}
</script>

<template>
  <div class="perfil">
    <div v-if="cargando" class="empty-block">Cargando tu perfil…</div>

    <template v-else-if="perfil">
      <!-- Tarjeta de cashback -->
      <section v-if="cashback" class="cashback-card">
        <p class="cb-title">Cashback</p>
        <p class="cb-sub">Disponible para tu próxima compra</p>

        <div class="cb-top-row">
          <div class="cb-saldo-box">
            <p class="lbl">Saldo disponible</p>
            <p class="amt">{{ dinero(cashback.saldo) }}</p>
          </div>
          <div class="cb-medal-col">
            <span class="medal-emoji">🥉</span>
            <span class="medal-lbl">{{ cashback.nivelActual ?? 'Sin nivel' }}</span>
          </div>
        </div>

        <div v-if="cashback.proximoNivel" class="cb-next-level-box">
          <p class="lvl-t">Próximo nivel: {{ cashback.proximoNivel }}</p>
          <div class="cb-progress">
            <div class="cb-progress-fill" :style="{ width: `${cashback.progresoPct}%` }">
              {{ Math.round(cashback.progresoPct) }}%
            </div>
          </div>
          <p class="lvl-s">Te faltan {{ dinero(cashback.montoFaltante) }} para alcanzarlo</p>
        </div>

        <RouterLink to="/perfil/cashback" class="cb-estado-link">Ver estado de cuenta</RouterLink>
      </section>

      <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error error-general">
        {{ mensaje }}
      </p>

      <!-- Datos personales -->
      <section class="profile-section-card">
        <h2 class="profile-section-title">👤 Datos personales</h2>

        <label class="form-label" for="p-nombre">Nombre</label>
        <input
          id="p-nombre"
          v-model="formulario.nombre"
          class="form-input"
          :class="{ 'is-invalid': errores.nombre }"
        />
        <p v-if="errores.nombre" class="form-error">{{ errores.nombre }}</p>

        <label class="form-label" for="p-telefono">WhatsApp</label>
        <input id="p-telefono" class="form-input" :value="perfil.telefono" disabled />
        <p class="nota">Tu número identifica tu cuenta y no se puede cambiar desde aquí.</p>

        <label class="form-label" for="p-email">Correo</label>
        <input
          id="p-email"
          v-model="formulario.email"
          class="form-input"
          :class="{ 'is-invalid': errores.email }"
          type="email"
        />
        <p v-if="errores.email" class="form-error">{{ errores.email }}</p>

        <label class="form-label" for="p-nacimiento">Fecha de nacimiento</label>
        <input id="p-nacimiento" v-model="fechaNacimiento" class="form-input" type="date" />
      </section>

      <!-- Quién recibe -->
      <section class="profile-section-card">
        <h2 class="profile-section-title">🙋 ¿Quién recibe?</h2>
        <label class="form-label" for="p-recibe">Nombre de quien recibe el pedido</label>
        <input
          id="p-recibe"
          v-model="formulario.quienRecibe"
          class="form-input"
          placeholder="Si no estás tú"
        />

        <!--
          La sucursal no es parte de la dirección de entrega: la usa el panel
          para segmentar campañas (Word 4.9.3).
        -->
        <label class="form-label" for="p-sucursal">Sucursal</label>
        <input
          id="p-sucursal"
          v-model="formulario.sucursal"
          class="form-input"
          placeholder="La sucursal donde compras"
        />
      </section>

      <!-- Dirección con mapa -->
      <section class="profile-section-card">
        <h2 class="profile-section-title">📍 Dirección de entrega</h2>

        <label class="form-label" for="p-calle">Calle y número</label>
        <input id="p-calle" v-model="formulario.calle" class="form-input" />

        <div class="form-row-2">
          <div>
            <label class="form-label" for="p-colonia">Colonia</label>
            <input id="p-colonia" v-model="formulario.colonia" class="form-input" />
          </div>
          <div>
            <label class="form-label" for="p-cp">Código postal</label>
            <input id="p-cp" v-model="formulario.cp" class="form-input" inputmode="numeric" />
          </div>
        </div>

        <div class="form-row-2">
          <div>
            <label class="form-label" for="p-ciudad">Ciudad</label>
            <input id="p-ciudad" v-model="formulario.ciudad" class="form-input" />
          </div>
          <div>
            <label class="form-label" for="p-estado">Estado</label>
            <input id="p-estado" v-model="formulario.estado" class="form-input" />
          </div>
        </div>

        <label class="form-label" for="p-referencias">Referencias</label>
        <textarea
          id="p-referencias"
          v-model="formulario.referencias"
          class="form-textarea"
          placeholder="Portón verde, entre dos tiendas…"
        />

        <MapaDireccion :lat="lat" :lng="lng" @mover="fijarCoordenadas" />
      </section>

      <!-- Notificaciones -->
      <section class="profile-section-card">
        <h2 class="profile-section-title">🔔 Notificaciones</h2>
        <div class="toggle-row sin-margen">
          <div>
            <p class="t-lbl">Avisos por WhatsApp</p>
            <p class="t-sub">Estado de tus pedidos, cupones y novedades.</p>
          </div>
          <label class="switch">
            <input v-model="formulario.notificaciones" type="checkbox" />
            <span class="slider-switch" />
          </label>
        </div>
      </section>

      <div class="save-profile-wrap">
        <button type="button" class="btn-primary" :disabled="guardando" @click="guardar">
          {{ guardando ? 'Guardando…' : 'Guardar cambios' }}
        </button>
      </div>

      <RouterLink to="/perfil/pedidos" class="profile-menu-item">
        <span>🧾</span><span class="flex">Mis pedidos</span><span class="chev">›</span>
      </RouterLink>
      <RouterLink to="/cupones" class="profile-menu-item">
        <span>🎁</span><span class="flex">Mis cupones</span><span class="chev">›</span>
      </RouterLink>

      <div class="salir-wrap">
        <button type="button" class="btn-cancel" @click="salir">Cerrar sesión</button>
      </div>
    </template>

    <p v-else class="empty-block">No pudimos cargar tu perfil.</p>
  </div>
</template>

<style scoped>
.perfil {
  padding: 12px 0 24px;
}

.error-general {
  margin: 0 18px 12px;
}

.nota {
  font-size: 10.5px;
  color: var(--muted);
  margin: -6px 0 12px;
  line-height: 1.4;
}

.profile-section-card {
  margin: 0 18px 16px;
  background: var(--white);
  border-radius: 16px;
  padding: 16px;
  box-shadow: var(--shadow);
}

.profile-section-title {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 16px;
  color: var(--sage);
  margin: 0 0 12px;
  display: flex;
  align-items: center;
  gap: 7px;
}

.sin-margen {
  margin-bottom: 0;
}

.save-profile-wrap {
  margin: 0 18px 16px;
}

.save-profile-wrap .btn-primary {
  width: 100%;
  padding: 14px;
  font-size: 14px;
  border-radius: 16px;
}

.profile-menu-item {
  margin: 0 18px 10px;
  background: var(--white);
  border-radius: 14px;
  padding: 13px 14px;
  box-shadow: var(--shadow);
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 13px;
  color: var(--ink);
  text-decoration: none;
}

.profile-menu-item .flex {
  flex: 1;
  min-width: 0;
}

.profile-menu-item .chev {
  color: var(--muted);
  font-size: 18px;
}

.salir-wrap {
  margin: 18px 18px 0;
}

.salir-wrap .btn-cancel {
  width: 100%;
}

/* ---- Tarjeta de cashback ---- */

.cashback-card {
  margin: 0 18px 16px;
  background: linear-gradient(135deg, #4caf50, #388e3c);
  border-radius: 18px;
  padding: 18px;
  color: var(--white);
  box-shadow: var(--shadow);
}

.cb-title {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 16px;
  margin: 0;
}

.cb-sub {
  font-size: 11.5px;
  opacity: 0.85;
  margin: 2px 0 14px;
}

.cb-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 14px;
}

.cb-saldo-box .lbl {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.85;
  margin: 0;
  font-weight: 700;
}

.cb-saldo-box .amt {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 26px;
  margin: 2px 0 0;
}

.cb-medal-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.medal-emoji {
  font-size: 26px;
}

.medal-lbl {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 10.5px;
}

.cb-next-level-box {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 12px;
}

.lvl-t {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  margin: 0 0 8px;
}

.cb-progress {
  background: rgba(0, 0, 0, 0.25);
  border-radius: 20px;
  height: 20px;
  overflow: hidden;
}

.cb-progress-fill {
  background: var(--gold);
  height: 100%;
  border-radius: 20px;
  display: flex;
  align-items: center;
  padding-left: 10px;
  color: var(--ink);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 10.5px;
  transition: width 0.3s ease;
  min-width: 34px;
}

.lvl-s {
  font-size: 10.5px;
  opacity: 0.85;
  margin: 8px 0 0;
}

.cb-estado-link {
  display: block;
  text-align: center;
  margin-top: 14px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  color: var(--white);
  text-decoration: underline;
  padding: 4px;
}
</style>
