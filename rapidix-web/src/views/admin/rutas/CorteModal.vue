<script setup lang="ts">
/**
 * El corte del día: el dinero que se entrega y la mercancía que regresa.
 *
 * Primero se enseña lo que el sistema dice que trae —para que cuente contra un
 * número y no contra su memoria— y aparte se captura lo que él declara. Los dos
 * se guardan uno al lado del otro: de esa diferencia vive Finanzas.
 *
 * Cerrar es lo que **descarga el camión**: hasta aquí, lo que el cliente no
 * aceptó seguía físicamente arriba.
 */
import { onMounted, ref } from 'vue'
import { ErrorApi, http } from '@/api/http'
import { dinero, fechaNumerica, nombreEstadoPedido } from '@/utils/formato'
import type { Corte, ResumenCorte } from '@/api/tipos'

const emit = defineEmits<{ (e: 'cerrar'): void; (e: 'cortado'): void }>()

const resumen = ref<ResumenCorte | null>(null)
/** El corte ya cerrado. Mientras es `null`, la hoja está capturando. */
const corte = ref<Corte | null>(null)
const cargando = ref(true)
const enviando = ref(false)
const error = ref('')

const declarado = ref<number | ''>('')
const notas = ref('')

onMounted(async () => {
  try {
    resumen.value = await http.get<ResumenCorte>('/admin/rutas/corte')
  } catch (fallo) {
    error.value =
      fallo instanceof ErrorApi ? fallo.message : 'No pudimos calcular tu corte. Inténtalo otra vez.'
  } finally {
    cargando.value = false
  }
})

async function cerrarCorte(): Promise<void> {
  if (declarado.value === '' || declarado.value < 0) {
    error.value = 'Escribe cuánto dinero traes, aunque sea cero.'
    return
  }

  enviando.value = true
  error.value = ''
  try {
    corte.value = await http.post<Corte>('/admin/rutas/corte', {
      montoDeclarado: declarado.value,
      ...(notas.value.trim() ? { notas: notas.value.trim() } : {}),
    })
    // La jornada ya no existe: el tablero de atrás tiene que releerse.
    emit('cortado')
  } catch (fallo) {
    error.value =
      fallo instanceof ErrorApi ? fallo.message : 'No pudimos cerrar tu corte. Inténtalo otra vez.'
  } finally {
    enviando.value = false
  }
}

/**
 * Corregir lo declarado, mientras Finanzas no lo haya recibido.
 *
 * Se ofrece aquí y no en otra pantalla porque es el único momento en que el
 * repartidor tiene su corte delante: en cuanto cierra esta hoja, el corte vive
 * en Finanzas.
 */
async function corregir(): Promise<void> {
  if (!corte.value || declarado.value === '' || declarado.value < 0) return

  enviando.value = true
  error.value = ''
  try {
    corte.value = await http.patch<Corte>(`/admin/rutas/cortes/${corte.value.id}`, {
      montoDeclarado: declarado.value,
      ...(notas.value.trim() ? { notas: notas.value.trim() } : {}),
    })
  } catch (fallo) {
    error.value =
      fallo instanceof ErrorApi ? fallo.message : 'No pudimos corregir el monto declarado.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('cerrar')">
    <div class="modal-sheet" role="dialog" aria-label="Corte del día">
      <div class="modal-handle" />
      <p class="modal-title">{{ corte ? 'Tu corte quedó cerrado' : 'Hacer mi corte' }}</p>

      <p v-if="cargando" class="aviso">Calculando lo que traes…</p>

      <!-- Capturar: lo que dice el sistema, y aparte lo que dice él. -->
      <template v-else-if="!corte && resumen">
        <div v-if="resumen.pedidos.length > 0" class="tabla-envoltorio bloque">
          <table class="tabla">
            <thead>
              <tr>
                <th>Pedido</th>
                <th class="num">Regresan</th>
                <th class="num">Efectivo</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="pedido in resumen.pedidos" :key="pedido.id">
                <td>
                  <span class="folio">{{ pedido.folio }}</span>
                  <span class="sub">
                    {{ pedido.clienteNombre }} · {{ nombreEstadoPedido(pedido.estado) }}
                  </span>
                </td>
                <td class="num">{{ pedido.devueltas > 0 ? pedido.devueltas : '—' }}</td>
                <td class="num importe">{{ dinero(pedido.efectivo) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2">Efectivo que dice el sistema</td>
                <td class="num">{{ dinero(resumen.montoCalculado) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div v-else class="bloque">
          <div class="fila fuerte">
            <span>Efectivo que dice el sistema</span>
            <span>{{ dinero(resumen.montoCalculado) }}</span>
          </div>
          <p class="aviso">No entregaste nada en esta jornada.</p>
        </div>

        <p class="regresan">
          Al cerrar, {{ resumen.piezasQueRegresan }} pieza(s) vuelven a bodega
          <template v-if="resumen.pedidosQueRegresan > 0">
            y {{ resumen.pedidosQueRegresan }} pedido(s) sin entregar vuelven a la cola para salir
            otro día
          </template>
          . Tu camión queda vacío.
        </p>

        <label class="form-label" for="declarado">¿Cuánto dinero entregas?</label>
        <input
          id="declarado"
          v-model.number="declarado"
          class="form-input"
          type="number"
          inputmode="decimal"
          min="0"
          step="0.01"
          placeholder="0.00"
        />

        <textarea
          v-model="notas"
          class="form-textarea"
          rows="2"
          maxlength="1000"
          placeholder="Novedades de la jornada (opcional)"
        />

        <p v-if="error" class="form-error">{{ error }}</p>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" :disabled="enviando" @click="emit('cerrar')">
            Volver
          </button>
          <button type="button" class="btn-primary" :disabled="enviando" @click="cerrarCorte">
            {{ enviando ? 'Cerrando…' : 'Cerrar mi jornada' }}
          </button>
        </div>
      </template>

      <!-- Cerrado: lo que quedó escrito, y la última oportunidad de corregirlo. -->
      <template v-else-if="corte">
        <div class="bloque">
          <div class="fila"><span>Cerrado</span><span>{{ fechaNumerica(corte.cerradoEn) }}</span></div>
          <div class="fila">
            <span>Dice el sistema</span><span>{{ dinero(corte.montoCalculado) }}</span>
          </div>
          <div class="fila">
            <span>Declaraste</span><span>{{ dinero(corte.montoDeclarado) }}</span>
          </div>
          <div class="fila fuerte" :class="{ falta: corte.diferencia < 0 }">
            <span>{{ corte.diferencia < 0 ? 'Faltante' : 'Diferencia' }}</span>
            <span>{{ dinero(corte.diferencia) }}</span>
          </div>
        </div>

        <p class="regresan">
          Finanzas contará el dinero. Hasta que lo reciba puedes corregir lo que declaraste.
        </p>

        <label class="form-label" for="corregido">Corregir lo declarado</label>
        <input
          id="corregido"
          v-model.number="declarado"
          class="form-input"
          type="number"
          inputmode="decimal"
          min="0"
          step="0.01"
        />

        <p v-if="error" class="form-error">{{ error }}</p>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" :disabled="enviando" @click="corregir">
            {{ enviando ? 'Guardando…' : 'Corregir' }}
          </button>
          <button type="button" class="btn-primary" @click="emit('cerrar')">Listo</button>
        </div>
      </template>

      <template v-else>
        <p class="form-error">{{ error }}</p>
        <div class="modal-actions">
          <button type="button" class="btn-primary" @click="emit('cerrar')">Volver</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.aviso {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--muted);
}

.bloque {
  background: var(--white);
  border-radius: var(--radius-md);
  padding: 12px;
  margin-bottom: 12px;
}

.fila {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
  color: var(--ink);
  padding: 3px 0;
}

.fila.fuerte {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13.5px;
}

.fila.falta span {
  color: var(--rojo);
}

/* El total va al pie de la tabla, en la misma columna que los importes. */
.tabla tfoot td {
  padding: 10px 12px;
  border-top: 1px solid var(--line);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  color: var(--ink);
}

.bloque.tabla-envoltorio {
  padding: 0;
}

.bloque .aviso {
  margin: 6px 0 0;
}

.regresan {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.45;
}
</style>
