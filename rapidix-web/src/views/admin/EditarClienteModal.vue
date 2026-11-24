<script setup lang="ts">
/**
 * Administración → Clientes: corregir los datos de un cliente o prospecto.
 *
 * Son los mismos campos de «Mi Perfil» más el teléfono, que el cliente no
 * puede cambiar porque es con lo que entra. Si se cambia aquí, la próxima vez
 * entrará con el número nuevo; la sesión que tenga abierta sigue viva.
 *
 * El punto del mapa no se toca: se queda el que puso el cliente.
 */
import { computed, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import type { ActualizarClienteAdmin, Perfil, TiendaParaRecoger } from '@/api/tipos'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{
  (e: 'cerrar'): void
  /** Se guardó: quien abrió la hoja relee su lista. */
  (e: 'guardado', perfil: Perfil): void
}>()

const CAMPOS = [
  'nombre',
  'telefono',
  'email',
  'fechaNacimiento',
  'quienRecibe',
  'tiendaId',
  'calle',
  'colonia',
  'cp',
  'ciudad',
  'estado',
  'referencias',
] as const

const ui = useUiStore()
const perfil = ref<Perfil | null>(null)
const tiendas = ref<TiendaParaRecoger[]>([])
const formulario = ref<ActualizarClienteAdmin>({})
const cargando = ref(true)
const guardando = ref(false)
const errores = ref<Record<string, string>>({})
const erroresGenerales = ref<string[]>([])

/** `fechaNacimiento` llega en ISO completo y el `<input type="date">` quiere `YYYY-MM-DD`. */
const fechaNacimiento = computed({
  get: () => formulario.value.fechaNacimiento?.slice(0, 10) ?? '',
  set: (valor: string) => {
    formulario.value.fechaNacimiento = valor || undefined
  },
})

onMounted(async () => {
  try {
    perfil.value = await http.get<Perfil>(`/admin/clientes/${props.id}`)
    volcarAlFormulario(perfil.value)
  } catch (fallo) {
    ui.errorDeApi(fallo)
    emit('cerrar')
    return
  } finally {
    cargando.value = false
  }

  // Sin tiendas se sigue pudiendo editar el resto: la lista solo queda vacía.
  try {
    tiendas.value = await http.get<TiendaParaRecoger[]>('/tiendas')
  } catch {
    tiendas.value = []
  }
})

function volcarAlFormulario(datos: Perfil): void {
  formulario.value = {
    nombre: datos.nombre,
    telefono: datos.telefono,
    email: datos.email ?? undefined,
    fechaNacimiento: datos.fechaNacimiento ?? undefined,
    quienRecibe: datos.quienRecibe ?? undefined,
    // '' es «Sin sucursal» en la lista; al guardar se manda como `null`.
    tiendaId: datos.tiendaId ?? '',
    calle: datos.direccion.calle ?? undefined,
    colonia: datos.direccion.colonia ?? undefined,
    cp: datos.direccion.cp ?? undefined,
    ciudad: datos.direccion.ciudad ?? undefined,
    estado: datos.direccion.estado ?? undefined,
    referencias: datos.direccion.referencias ?? undefined,
    notificaciones: datos.notificaciones,
  }
}

/**
 * Manda solo lo que tiene valor, como «Mi Perfil». El teléfono solo si
 * cambió: así guardar otro campo no obliga a revisar que el número siga libre.
 */
function cuerpoDelPatch(): ActualizarClienteAdmin {
  const cuerpo: ActualizarClienteAdmin = {}
  for (const [clave, valor] of Object.entries(formulario.value)) {
    if (valor === undefined || valor === '') continue
    Object.assign(cuerpo, { [clave]: typeof valor === 'string' ? valor.trim() : valor })
  }
  if (cuerpo.telefono === perfil.value?.telefono) delete cuerpo.telefono
  cuerpo.tiendaId = formulario.value.tiendaId || null
  return cuerpo
}

async function guardar(): Promise<void> {
  if (guardando.value) return
  guardando.value = true
  errores.value = {}
  erroresGenerales.value = []
  try {
    const guardado = await http.patch<Perfil>(`/admin/clientes/${props.id}`, cuerpoDelPatch())
    ui.exito(`${guardado.nombre}: datos guardados.`)
    emit('guardado', guardado)
  } catch (fallo) {
    if (fallo instanceof ErrorApi) {
      const { campos, generales } = fallo.porCampo(CAMPOS)
      // El teléfono repetido llega como error de negocio: se pinta bajo su campo.
      if (fallo.codigo === 'TELEFONO_EN_USO') {
        errores.value = { telefono: fallo.message }
      } else {
        errores.value = campos
        const sinCampo = Object.keys(campos).length === 0 && generales.length === 0
        erroresGenerales.value = sinCampo ? [fallo.message] : generales
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
  <div class="modal-overlay" @click.self="emit('cerrar')">
    <div class="modal-sheet" role="dialog" aria-label="Editar cliente">
      <div class="modal-handle" />
      <p class="modal-title">Editar · {{ perfil?.nombre ?? 'cliente' }}</p>

      <p v-if="cargando" class="empty-block">Cargando…</p>

      <template v-else-if="perfil">
        <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error">
          {{ mensaje }}
        </p>

        <p class="seccion">Datos personales</p>
        <div class="zona-captura">
          <label class="form-label" for="ec-nombre">Nombre</label>
          <input
            id="ec-nombre"
            v-model="formulario.nombre"
            class="form-input"
            :class="{ 'is-invalid': errores.nombre }"
            maxlength="120"
          />
          <p v-if="errores.nombre" class="form-error">{{ errores.nombre }}</p>

          <label class="form-label" for="ec-telefono">WhatsApp</label>
          <input
            id="ec-telefono"
            v-model="formulario.telefono"
            class="form-input"
            :class="{ 'is-invalid': errores.telefono }"
            type="tel"
            inputmode="tel"
          />
          <p v-if="errores.telefono" class="form-error">{{ errores.telefono }}</p>
          <p v-else class="nota">Es con lo que entra a la app: si lo cambias, entrará con este.</p>

          <label class="form-label" for="ec-email">Correo</label>
          <input
            id="ec-email"
            v-model="formulario.email"
            class="form-input"
            :class="{ 'is-invalid': errores.email }"
            type="email"
          />
          <p v-if="errores.email" class="form-error">{{ errores.email }}</p>

          <label class="form-label" for="ec-nacimiento">Fecha de nacimiento</label>
          <input id="ec-nacimiento" v-model="fechaNacimiento" class="form-input" type="date" />

          <label class="form-label" for="ec-recibe">Quién recibe</label>
          <input id="ec-recibe" v-model="formulario.quienRecibe" class="form-input" />

          <label class="form-label" for="ec-sucursal">Sucursal</label>
          <select
            id="ec-sucursal"
            v-model="formulario.tiendaId"
            class="select-input"
            :class="{ 'is-invalid': errores.tiendaId }"
          >
            <option value="">Sin sucursal</option>
            <option v-for="t in tiendas" :key="t.id" :value="t.id">{{ t.nombre }}</option>
          </select>
          <p v-if="errores.tiendaId" class="form-error">{{ errores.tiendaId }}</p>
        </div>

        <p class="seccion">Dirección de entrega</p>
        <div class="zona-captura">
          <label class="form-label" for="ec-calle">Calle y número</label>
          <input id="ec-calle" v-model="formulario.calle" class="form-input" />

          <div class="form-row-2">
            <div>
              <label class="form-label" for="ec-colonia">Colonia</label>
              <input id="ec-colonia" v-model="formulario.colonia" class="form-input" />
            </div>
            <div>
              <label class="form-label" for="ec-cp">Código postal</label>
              <input id="ec-cp" v-model="formulario.cp" class="form-input" inputmode="numeric" />
            </div>
          </div>

          <div class="form-row-2">
            <div>
              <label class="form-label" for="ec-ciudad">Ciudad</label>
              <input id="ec-ciudad" v-model="formulario.ciudad" class="form-input" />
            </div>
            <div>
              <label class="form-label" for="ec-estado">Estado</label>
              <input id="ec-estado" v-model="formulario.estado" class="form-input" />
            </div>
          </div>

          <label class="form-label" for="ec-referencias">Referencias</label>
          <textarea id="ec-referencias" v-model="formulario.referencias" class="form-textarea" />
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" @click="emit('cerrar')">Cancelar</button>
          <button type="button" class="btn-primary" :disabled="guardando" @click="guardar">
            {{ guardando ? 'Guardando…' : 'Guardar cambios' }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.seccion {
  margin: 0 0 6px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

/* Bloque gris con los campos en blanco: se ve dónde se escribe. */
.zona-captura {
  background: var(--cream-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  margin-bottom: 14px;
}

.zona-captura .form-input,
.zona-captura .select-input,
.zona-captura .form-textarea {
  background: var(--white);
  /* 16px reales: con menos, Safari en iPhone amplía la página al enfocar el campo. */
  font-size: 16px;
}

.zona-captura .form-textarea {
  margin-bottom: 0;
}

.nota {
  margin: -4px 0 10px;
  font-size: 11px;
  color: var(--muted);
}

.form-error {
  margin: -4px 0 10px;
}
</style>
