<script setup lang="ts">
/**
 * Configuración → Tiendas: nombre, dirección y persona responsable.
 *
 * Una tienda tiene su propio inventario, aparte del de bodega. Se le manda
 * mercancía desde Productos → Movimientos («Transferencia a tienda») y la
 * recibe en PDV → Inventario.
 *
 * No hay botón de borrar: de una tienda cuelgan sus transferencias y su
 * inventario. Se retira apagándola, y deja de ofrecerse como destino.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import type { Tienda } from '@/api/tipos'

const ui = useUiStore()

const CAMPOS = ['nombre', 'direccion', 'responsable'] as const

const tiendas = ref<Tienda[]>([])
const cargando = ref(true)
const guardando = ref(false)
const errores = ref<Record<string, string>>({})
const erroresGenerales = ref<string[]>([])

const modalAbierto = ref(false)
const editando = ref<Tienda | null>(null)
const formulario = ref({ nombre: '', direccion: '', responsable: '', activa: true })

onMounted(cargar)

async function cargar(): Promise<void> {
  cargando.value = true
  try {
    tiendas.value = await http.get<Tienda[]>('/admin/configuracion/tiendas')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
}

function abrir(tienda: Tienda | null): void {
  editando.value = tienda
  formulario.value = tienda
    ? {
        nombre: tienda.nombre,
        direccion: tienda.direccion,
        responsable: tienda.responsable,
        activa: tienda.activa,
      }
    : { nombre: '', direccion: '', responsable: '', activa: true }
  errores.value = {}
  erroresGenerales.value = []
  modalAbierto.value = true
}

async function guardar(): Promise<void> {
  guardando.value = true
  errores.value = {}
  erroresGenerales.value = []
  try {
    const cuerpo = {
      nombre: formulario.value.nombre.trim(),
      direccion: formulario.value.direccion.trim(),
      responsable: formulario.value.responsable.trim(),
      activa: formulario.value.activa,
    }
    if (editando.value) {
      await http.patch(`/admin/configuracion/tiendas/${editando.value.id}`, cuerpo)
      ui.exito('Tienda actualizada')
    } else {
      await http.post('/admin/configuracion/tiendas', cuerpo)
      ui.exito('Tienda creada')
    }
    modalAbierto.value = false
    await cargar()
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
</script>

<template>
  <div class="pantalla sin-colchon">
    <RouterLink to="/admin/configuracion" class="admin-back-inline">
      ← Volver a Configuración
    </RouterLink>

    <button type="button" class="btn-primary ancho" @click="abrir(null)">+ Nueva tienda</button>

    <p v-if="cargando" class="empty-block">Cargando…</p>

    <div v-else-if="tiendas.length > 0" class="tabla-envoltorio">
      <table class="tabla">
        <thead>
          <tr>
            <th>Tienda</th>
            <th>Dirección</th>
            <th>Responsable</th>
            <th>Estatus</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="tienda in tiendas" :key="tienda.id" :class="{ apagada: !tienda.activa }">
            <td>
              <span class="folio">{{ tienda.nombre }}</span>
            </td>
            <td>{{ tienda.direccion }}</td>
            <td>{{ tienda.responsable }}</td>
            <td>
              <span class="mini-tag">{{ tienda.activa ? 'Activa' : 'Desactivada' }}</span>
            </td>
            <td class="num">
              <button
                type="button"
                class="accion"
                :aria-label="`Editar ${tienda.nombre}`"
                @click="abrir(tienda)"
              >
                ✏️
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else class="empty-block">Todavía no hay tiendas dadas de alta.</p>

    <div v-if="modalAbierto" class="modal-overlay" @click.self="modalAbierto = false">
      <div class="modal-sheet" role="dialog">
        <div class="modal-handle" />
        <p class="modal-title">{{ editando ? '✏️ Editar tienda' : '🏪 Nueva tienda' }}</p>

        <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error">{{ mensaje }}</p>

        <label class="form-label" for="ti-nombre">Nombre de la tienda</label>
        <input
          id="ti-nombre"
          v-model="formulario.nombre"
          class="form-input"
          :class="{ 'is-invalid': errores.nombre }"
          placeholder="Ej. Sucursal Centro"
        />
        <p v-if="errores.nombre" class="form-error">{{ errores.nombre }}</p>

        <label class="form-label" for="ti-direccion">Dirección</label>
        <input
          id="ti-direccion"
          v-model="formulario.direccion"
          class="form-input"
          :class="{ 'is-invalid': errores.direccion }"
          placeholder="Calle, número, colonia"
        />
        <p v-if="errores.direccion" class="form-error">{{ errores.direccion }}</p>

        <label class="form-label" for="ti-responsable">Persona responsable</label>
        <input
          id="ti-responsable"
          v-model="formulario.responsable"
          class="form-input"
          :class="{ 'is-invalid': errores.responsable }"
          placeholder="Quién está a cargo de la tienda"
        />
        <p v-if="errores.responsable" class="form-error">{{ errores.responsable }}</p>

        <div v-if="editando" class="toggle-row">
          <div>
            <p class="t-lbl">Tienda activa</p>
            <p class="t-sub">Apagada, ya no se le pueden mandar transferencias.</p>
          </div>
          <label class="switch">
            <input v-model="formulario.activa" type="checkbox" />
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
  min-width: 520px;
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
</style>
