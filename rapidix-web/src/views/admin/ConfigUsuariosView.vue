<script setup lang="ts">
/**
 * Configuración → Usuarios: las cuentas del personal del negocio.
 *
 * Cada cuenta entra en el login por la tarjeta de su rol, con su usuario y su
 * contraseña. Los clientes no se dan de alta aquí: su cuenta es su número de
 * WhatsApp.
 *
 * La tienda solo es obligatoria para PDV: su punto de venta no le ofrece otra.
 * No hay botón de borrar: de una cuenta cuelgan turnos, cortes y cobros. Se
 * retira desactivándola, y ya no puede entrar.
 */
import { computed, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import type { RolPersonal, Tienda, UsuarioPanel } from '@/api/tipos'

const ui = useUiStore()
const auth = useAuthStore()

const ROLES: { rol: RolPersonal; nombre: string }[] = [
  { rol: 'ADMINISTRADOR', nombre: 'Administrador' },
  { rol: 'RUTA', nombre: 'Ruta' },
  { rol: 'OPERACIONES', nombre: 'Operaciones' },
  { rol: 'FINANZAS', nombre: 'Finanzas' },
  { rol: 'PDV', nombre: 'PDV' },
]
const NOMBRE_ROL = Object.fromEntries(ROLES.map((r) => [r.rol, r.nombre])) as Record<
  RolPersonal,
  string
>

const CAMPOS = [
  'nombre',
  'apellidos',
  'fechaIngreso',
  'usuario',
  'password',
  'tiendaId',
  'rol',
] as const

const usuarios = ref<UsuarioPanel[]>([])
const tiendas = ref<Tienda[]>([])
const cargando = ref(true)
const guardando = ref(false)
const errores = ref<Record<string, string>>({})
const erroresGenerales = ref<string[]>([])

const modalAbierto = ref(false)
const editando = ref<UsuarioPanel | null>(null)

interface Formulario {
  nombre: string
  apellidos: string
  fechaIngreso: string
  usuario: string
  password: string
  tiendaId: string
  rol: RolPersonal | ''
  activo: boolean
}

const formulario = ref<Formulario>(vacio())

/** Hoy en la zona del navegador, `AAAA-MM-DD`: el valor por defecto del alta. */
function hoy(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function vacio(): Formulario {
  return {
    nombre: '',
    apellidos: '',
    fechaIngreso: hoy(),
    usuario: '',
    password: '',
    tiendaId: '',
    rol: '',
    activo: true,
  }
}

/** Se puede asignar cualquier tienda activa, y la que ya tenía aunque se apagara. */
const tiendasElegibles = computed(() =>
  tiendas.value.filter((t) => t.activa || t.id === editando.value?.tiendaId),
)

const esMiCuenta = computed(() => editando.value?.id === auth.usuario?.sub)

onMounted(cargar)

async function cargar(): Promise<void> {
  cargando.value = true
  try {
    const [listaUsuarios, listaTiendas] = await Promise.all([
      http.get<UsuarioPanel[]>('/admin/configuracion/usuarios'),
      http.get<Tienda[]>('/admin/configuracion/tiendas'),
    ])
    usuarios.value = listaUsuarios
    tiendas.value = listaTiendas
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
}

function abrir(usuario: UsuarioPanel | null): void {
  editando.value = usuario
  formulario.value = usuario
    ? {
        nombre: usuario.nombre,
        apellidos: usuario.apellidos,
        fechaIngreso: usuario.fechaIngreso ?? '',
        usuario: usuario.usuario,
        password: '',
        tiendaId: usuario.tiendaId ?? '',
        rol: usuario.rol,
        activo: usuario.activo,
      }
    : vacio()
  errores.value = {}
  erroresGenerales.value = []
  modalAbierto.value = true
}

function formatearFecha(fecha: string | null): string {
  if (!fecha) return '—'
  const [a, m, d] = fecha.split('-')
  return `${d}/${m}/${a}`
}

async function guardar(): Promise<void> {
  guardando.value = true
  errores.value = {}
  erroresGenerales.value = []
  try {
    const f = formulario.value
    const cuerpo = {
      nombre: f.nombre.trim(),
      apellidos: f.apellidos.trim(),
      fechaIngreso: f.fechaIngreso,
      usuario: f.usuario.trim(),
      password: f.password,
      tiendaId: f.tiendaId,
      rol: f.rol,
      ...(editando.value && { activo: f.activo }),
    }
    if (editando.value) {
      await http.patch(`/admin/configuracion/usuarios/${editando.value.id}`, cuerpo)
      ui.exito('Usuario actualizado')
    } else {
      await http.post('/admin/configuracion/usuarios', cuerpo)
      ui.exito('Usuario creado')
    }
    modalAbierto.value = false
    await cargar()
  } catch (fallo) {
    if (fallo instanceof ErrorApi) {
      const { campos, generales } = fallo.porCampo(CAMPOS)
      errores.value = campos
      erroresGenerales.value = generales.length > 0 ? generales : [fallo.message]
      // El usuario repetido se enseña bajo su campo, no arriba.
      if (fallo.codigo === 'USUARIO_DUPLICADO') {
        errores.value = { ...errores.value, usuario: fallo.message }
        erroresGenerales.value = []
      }
    } else {
      ui.errorDeApi(fallo)
    }
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <div class="pantalla sin-colchon">
    <RouterLink to="/admin/configuracion" class="admin-back-inline">
      ← Volver a Configuración
    </RouterLink>

    <button type="button" class="btn-primary ancho" @click="abrir(null)">+ Nuevo usuario</button>

    <p v-if="cargando" class="empty-block">Cargando…</p>

    <div v-else-if="usuarios.length > 0" class="tabla-envoltorio">
      <table class="tabla">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Usuario</th>
            <th>Rol</th>
            <th>Tienda</th>
            <th>Ingreso</th>
            <th>Estatus</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in usuarios" :key="u.id" :class="{ apagada: !u.activo }">
            <td>
              <span class="folio">{{ u.nombre }} {{ u.apellidos }}</span>
            </td>
            <td>{{ u.usuario }}</td>
            <td>{{ NOMBRE_ROL[u.rol] }}</td>
            <td>{{ u.tienda ?? '—' }}</td>
            <td>{{ formatearFecha(u.fechaIngreso) }}</td>
            <td>
              <span class="mini-tag">{{ u.activo ? 'Activo' : 'Desactivado' }}</span>
            </td>
            <td class="num">
              <button
                type="button"
                class="accion"
                :aria-label="`Editar ${u.usuario}`"
                @click="abrir(u)"
              >
                ✏️
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else class="empty-block">Todavía no hay usuarios dados de alta.</p>

    <div v-if="modalAbierto" class="modal-overlay" @click.self="modalAbierto = false">
      <div class="modal-sheet" role="dialog">
        <div class="modal-handle" />
        <p class="modal-title">{{ editando ? '✏️ Editar usuario' : '👤 Nuevo usuario' }}</p>

        <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error">{{ mensaje }}</p>

        <div class="zona-captura">
          <div class="fila-2">
            <div>
              <label class="form-label" for="us-nombre">Nombre</label>
              <input
                id="us-nombre"
                v-model="formulario.nombre"
                class="form-input"
                :class="{ 'is-invalid': errores.nombre }"
                autocomplete="off"
                placeholder="Ej. Ana"
              />
              <p v-if="errores.nombre" class="form-error">{{ errores.nombre }}</p>
            </div>
            <div>
              <label class="form-label" for="us-apellidos">Apellidos</label>
              <input
                id="us-apellidos"
                v-model="formulario.apellidos"
                class="form-input"
                :class="{ 'is-invalid': errores.apellidos }"
                autocomplete="off"
                placeholder="Ej. López Pérez"
              />
              <p v-if="errores.apellidos" class="form-error">{{ errores.apellidos }}</p>
            </div>
          </div>

          <label class="form-label" for="us-ingreso">Fecha de ingreso</label>
          <input
            id="us-ingreso"
            v-model="formulario.fechaIngreso"
            class="form-input"
            :class="{ 'is-invalid': errores.fechaIngreso }"
            type="date"
          />
          <p v-if="errores.fechaIngreso" class="form-error">{{ errores.fechaIngreso }}</p>

          <div class="fila-2">
            <div>
              <label class="form-label" for="us-usuario">Usuario</label>
              <input
                id="us-usuario"
                v-model="formulario.usuario"
                class="form-input"
                :class="{ 'is-invalid': errores.usuario }"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                autocomplete="off"
                placeholder="Ej. ana.lopez"
              />
              <p v-if="errores.usuario" class="form-error">{{ errores.usuario }}</p>
            </div>
            <div>
              <label class="form-label" for="us-password">Contraseña</label>
              <input
                id="us-password"
                v-model="formulario.password"
                class="form-input"
                :class="{ 'is-invalid': errores.password }"
                type="password"
                autocomplete="new-password"
                :placeholder="editando ? 'Déjala vacía para no cambiarla' : 'Mínimo 3 caracteres'"
              />
              <p v-if="errores.password" class="form-error">{{ errores.password }}</p>
            </div>
          </div>

          <div class="fila-2">
            <div>
              <label class="form-label" for="us-rol">Rol</label>
              <select
                id="us-rol"
                v-model="formulario.rol"
                class="form-input"
                :class="{ 'is-invalid': errores.rol }"
                :disabled="esMiCuenta"
              >
                <option value="" disabled>Elige un rol</option>
                <option v-for="r in ROLES" :key="r.rol" :value="r.rol">{{ r.nombre }}</option>
              </select>
              <p v-if="errores.rol" class="form-error">{{ errores.rol }}</p>
            </div>
            <div>
              <label class="form-label" for="us-tienda">
                Tienda asignada{{ formulario.rol === 'PDV' ? '' : ' (opcional)' }}
              </label>
              <select
                id="us-tienda"
                v-model="formulario.tiendaId"
                class="form-input"
                :class="{ 'is-invalid': errores.tiendaId }"
              >
                <option value="">Sin tienda</option>
                <option v-for="t in tiendasElegibles" :key="t.id" :value="t.id">
                  {{ t.nombre }}
                </option>
              </select>
              <p v-if="errores.tiendaId" class="form-error">{{ errores.tiendaId }}</p>
            </div>
          </div>
          <p v-if="tiendas.length === 0" class="nota">
            No hay tiendas. Da de alta una en Configuración → Tiendas.
          </p>
        </div>

        <div v-if="editando" class="toggle-row">
          <div>
            <p class="t-lbl">Usuario activo</p>
            <p class="t-sub">
              {{
                esMiCuenta
                  ? 'Es tu cuenta: no puedes desactivarla.'
                  : 'Desactivado, ya no puede entrar.'
              }}
            </p>
          </div>
          <label class="switch">
            <input v-model="formulario.activo" type="checkbox" :disabled="esMiCuenta" />
            <span class="slider-switch" />
          </label>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" @click="modalAbierto = false">Cancelar</button>
          <button type="button" class="btn-primary" :disabled="guardando" @click="guardar">
            {{ guardando ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pantalla {
  padding: 12px 18px 0;
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

.ancho {
  width: 100%;
  margin-bottom: 14px;
}

.tabla {
  min-width: 720px;
}

.apagada td {
  color: var(--muted);
}

.accion {
  background: var(--cream);
  border: none;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
}

.zona-captura {
  margin-bottom: 12px;
}

.fila-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 10px;
}

.nota {
  font-size: 11px;
  color: var(--muted);
  margin: 4px 0 0;
}
</style>
