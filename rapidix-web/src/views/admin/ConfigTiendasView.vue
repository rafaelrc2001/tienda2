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
 *
 * Cada tienda factura por defecto con una de las cuentas de factura.com del
 * servidor (Configuración → Fiscal); sin elegir, con la principal. El punto
 * de venta puede cambiarla al facturar.
 *
 * El horario es día por día (el sábado puede cerrar antes y no todas abren el
 * domingo). Es informativo: no bloquea pedidos; fuera de él el carrito avisa
 * que el pedido queda programado para la siguiente apertura.
 */
import { computed, onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { DIAS_SEMANA, horarioPorDefecto, resumenHorario } from '@/utils/horario'
import type { ClaveDia, EmisorServidor, HorarioSemanal, Tienda } from '@/api/tipos'

const ui = useUiStore()

const CAMPOS = ['nombre', 'direccion', 'responsable', 'emisorRfc'] as const

const tiendas = ref<Tienda[]>([])
const cargando = ref(true)
const guardando = ref(false)
const errores = ref<Record<string, string>>({})
const erroresGenerales = ref<string[]>([])

const modalAbierto = ref(false)
const editando = ref<Tienda | null>(null)
const formulario = ref({
  nombre: '',
  direccion: '',
  responsable: '',
  activa: true,
  /** `''` = la cuenta principal. */
  emisorRfc: '',
  horario: horarioPorDefecto(),
})

/** Prender un día le pone las horas de siempre; apagarlo lo deja cerrado. */
function alternarDia(clave: ClaveDia, abre: boolean): void {
  formulario.value.horario[clave] = abre ? { abre: '09:00', cierra: '18:00' } : null
}

/** Las cuentas de factura.com del servidor. Si no se leen, la tienda se edita igual. */
const emisores = ref<EmisorServidor['emisores']>([])
const principal = computed(() => emisores.value.find((e) => e.principal) ?? null)

onMounted(() => {
  void cargar()
  http
    .get<EmisorServidor>('/admin/configuracion/emisor')
    .then((r) => (emisores.value = r.emisores))
    .catch(() => undefined)
})

/** A nombre de quién factura la tienda, como se lee en la tabla. */
function facturaComo(tienda: Tienda): string {
  if (!tienda.emisorRfc) return principal.value?.nombre ?? 'Principal'
  return emisores.value.find((e) => e.rfc === tienda.emisorRfc)?.nombre ?? tienda.emisorRfc
}

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
        emisorRfc: tienda.emisorRfc ?? '',
        // Copia: editar la ficha no debe tocar la fila de la tabla si se cancela.
        horario: tienda.horario ? copiarHorario(tienda.horario) : horarioPorDefecto(),
      }
    : {
        nombre: '',
        direccion: '',
        responsable: '',
        activa: true,
        emisorRfc: '',
        horario: horarioPorDefecto(),
      }
  errores.value = {}
  erroresGenerales.value = []
  modalAbierto.value = true
}

function copiarHorario(horario: HorarioSemanal): HorarioSemanal {
  return Object.fromEntries(
    DIAS_SEMANA.map(({ clave }) => [clave, horario[clave] ? { ...horario[clave] } : null]),
  ) as HorarioSemanal
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
      emisorRfc: formulario.value.emisorRfc || null,
      horario: formulario.value.horario,
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
            <th>Factura como</th>
            <th>Horario</th>
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
            <td>{{ facturaComo(tienda) }}</td>
            <td class="horario-resumen">
              {{ tienda.horario ? resumenHorario(tienda.horario) : 'Sin capturar' }}
            </td>
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

        <!-- Con una sola cuenta de factura.com no hay nada que elegir. -->
        <template v-if="emisores.length > 1">
          <label class="form-label" for="ti-emisor">Factura a nombre de</label>
          <select
            id="ti-emisor"
            v-model="formulario.emisorRfc"
            class="form-input"
            :class="{ 'is-invalid': errores.emisorRfc }"
          >
            <option value="">Principal · {{ principal?.nombre }}</option>
            <option v-for="e in emisores.filter((x) => !x.principal)" :key="e.rfc" :value="e.rfc">
              {{ e.nombre }} · {{ e.rfc }}
            </option>
          </select>
          <p v-if="errores.emisorRfc" class="form-error">{{ errores.emisorRfc }}</p>
          <p class="form-hint">El punto de venta puede cambiarlo al facturar.</p>
        </template>

        <label class="form-label">Horario</label>
        <div class="zona-horario">
          <div v-for="dia in DIAS_SEMANA" :key="dia.clave" class="fila-dia">
            <label class="dia-check">
              <input
                type="checkbox"
                :checked="formulario.horario[dia.clave] !== null"
                @change="alternarDia(dia.clave, ($event.target as HTMLInputElement).checked)"
              />
              {{ dia.largo }}
            </label>
            <template v-if="formulario.horario[dia.clave]">
              <input
                v-model="formulario.horario[dia.clave]!.abre"
                class="form-input hora"
                type="time"
                :aria-label="`${dia.largo}: abre`"
              />
              <span class="a">a</span>
              <input
                v-model="formulario.horario[dia.clave]!.cierra"
                class="form-input hora"
                type="time"
                :aria-label="`${dia.largo}: cierra`"
              />
            </template>
            <span v-else class="cerrado">Cerrado</span>
          </div>
        </div>
        <p class="form-hint">
          Informativo: fuera de horario el pedido se acepta y se le avisa al cliente que queda
          programado para la siguiente apertura.
        </p>

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
  min-width: 620px;
}

.apagada td {
  color: var(--muted);
}

.horario-resumen {
  min-width: 180px;
  white-space: normal;
  font-size: 11.5px;
}

/* Bloque gris con los campos en blanco: se ve dónde se escribe. */
.zona-horario {
  background: var(--cream-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 6px 10px;
  margin-bottom: 6px;
}

.fila-dia {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
}

.fila-dia + .fila-dia {
  border-top: 1px solid var(--line);
}

.dia-check {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 104px;
  flex-shrink: 0;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  color: var(--ink);
}

.dia-check input {
  width: 16px;
  height: 16px;
  accent-color: var(--sage);
}

.hora {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 6px 8px;
  background: var(--white);
  /* 16px reales: con menos, Safari en iPhone amplía la página al enfocar el campo. */
  font-size: 16px;
}

.a {
  font-size: 12px;
  color: var(--muted);
}

.cerrado {
  font-size: 12px;
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
