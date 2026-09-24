<script setup lang="ts">
/**
 * «Entregado»: el recuento de lo que baja del camión, delante del cliente.
 *
 * Se captura lo que **acepta**, renglón por renglón, porque es lo que el
 * repartidor cuenta en la puerta; lo devuelto es la resta. Van todos los
 * renglones y ninguno de más: la API exige el recuento completo para que un
 * olvido de la pantalla no acabe cobrando mercancía que nadie recibió.
 *
 * La evidencia —foto, ubicación— es opcional y **no frena la entrega**: la
 * cámara puede fallar y el cliente puede negar el permiso de ubicación.
 */
import { onMounted, reactive, ref } from 'vue'
import { ErrorApi, http, subirAUrlFirmada } from '@/api/http'
import { dinero } from '@/utils/formato'
import { reducirImagen } from '@/utils/reducirImagen'
import { itemsDeLaEntrega, piezasDelRecuento, problemaDelRecuento } from './recuento'
import { MOTIVOS } from './etiquetas'
import type { RenglonContado } from './recuento'
import type { PedidoEnRuta, ResultadoEntrega } from '@/api/tipos'

const props = defineProps<{ pedido: PedidoEnRuta }>()
const emit = defineEmits<{
  (e: 'cerrar'): void
  (e: 'entregado', resultado: ResultadoEntrega): void
}>()

const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp']
const TAMANO_MAXIMO_BYTES = 5 * 1024 * 1024

/** Lo que la API firma para subir una imagen. */
interface FirmaSubida {
  urlSubida: string
  urlPublica: string
  clave: string
  destino: 'S3' | 'LOCAL'
}

/**
 * Solo lo que sigue arriba del camión. Un renglón ya cerrado es el intento de
 * otro día y no se vuelve a contar.
 */
const renglones = reactive<RenglonContado[]>(
  props.pedido.carga
    .filter((c) => c.enCamion)
    .map((c) => ({
      pedidoItemId: c.pedidoItemId,
      nombre: `${c.nombre} (${c.unidad})`,
      cantidadCargada: c.cantidadCargada,
      // Se arranca con la entrega completa: es lo que pasa casi siempre y así
      // el repartidor solo toca lo que no cuadra.
      cantidadEntregada: c.cantidadCargada,
      motivoDevolucion: null,
    })),
)

const nota = ref('')
const enviando = ref(false)
const error = ref('')

/** Evidencia. Ninguna de las tres es obligatoria. */
const fotoId = ref<string | null>(null)
const fotoUrl = ref('')
const subiendo = ref(false)
const ubicacion = ref<{ lat: number; lng: number } | null>(null)
const buscandoUbicacion = ref(true)

/**
 * La ubicación se pide sola al abrir: es un dato de la entrega y pedírsela al
 * repartidor sería un toque más en la puerta de un cliente. Si la niega o no
 * llega, se entrega igual.
 */
onMounted(() => {
  if (!navigator.geolocation) {
    buscandoUbicacion.value = false
    return
  }
  navigator.geolocation.getCurrentPosition(
    (posicion) => {
      ubicacion.value = { lat: posicion.coords.latitude, lng: posicion.coords.longitude }
      buscandoUbicacion.value = false
    },
    () => {
      buscandoUbicacion.value = false
    },
    { enableHighAccuracy: true, timeout: 10000 },
  )
})

function ajustar(renglon: RenglonContado, delta: number): void {
  const contadas = (renglon.cantidadEntregada || 0) + delta
  renglon.cantidadEntregada = Math.min(Math.max(contadas, 0), renglon.cantidadCargada)
  limpiarMotivo(renglon)
}

/** El motivo acompaña a lo que sobra, y solo a eso. */
function limpiarMotivo(renglon: RenglonContado): void {
  if (renglon.cantidadEntregada >= renglon.cantidadCargada) renglon.motivoDevolucion = null
}

async function adjuntarFoto(evento: Event): Promise<void> {
  const entrada = evento.target as HTMLInputElement
  const original = entrada.files?.[0]
  entrada.value = ''
  if (!original) return

  error.value = ''
  if (!TIPOS_PERMITIDOS.includes(original.type)) {
    error.value = 'Usa una foto JPG, PNG o WebP.'
    return
  }

  subiendo.value = true
  try {
    // La foto de la cámara se achica antes de viajar: pesa una fracción y deja
    // de chocar con el tope de 5 MB.
    const archivo = await reducirImagen(original)
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      error.value = 'La foto no puede pesar más de 5 MB.'
      return
    }

    const firma = await http.post<FirmaSubida>('/uploads/firma', {
      carpeta: 'entregas',
      contentType: archivo.type,
      tamanoBytes: archivo.size,
    })
    await subirAUrlFirmada(firma.urlSubida, archivo)
    fotoUrl.value = firma.urlPublica
    // La entrega guarda el **id de la fila** de la imagen, y esa fila solo
    // existe cuando la API es quien la almacena: con un bucket detrás la clave
    // es `entregas/algo.jpg`, que la API rechaza. La foto se sube igual; lo que
    // no se manda es una referencia que no va a poder resolver.
    fotoId.value = firma.destino === 'LOCAL' ? firma.clave : null
  } catch (fallo) {
    // La evidencia no bloquea: se avisa dentro de la hoja y se puede entregar.
    error.value =
      fallo instanceof ErrorApi && fallo.estado === 503
        ? 'La subida de fotos no está disponible ahora mismo. Puedes entregar sin ella.'
        : 'No pudimos subir la foto. Puedes entregar sin ella.'
  } finally {
    subiendo.value = false
  }
}

function quitarFoto(): void {
  fotoId.value = null
  fotoUrl.value = ''
}

async function entregar(): Promise<void> {
  // Confirmar a media subida mandaría la entrega sin su foto: se espera.
  if (subiendo.value) return
  const problema = problemaDelRecuento(renglones)
  if (problema) {
    error.value = problema
    return
  }

  enviando.value = true
  error.value = ''
  try {
    const resultado = await http.post<ResultadoEntrega>(
      `/admin/rutas/pedidos/${props.pedido.id}/entregar`,
      {
        items: itemsDeLaEntrega(renglones),
        ...(fotoId.value ? { fotoId: fotoId.value } : {}),
        ...(ubicacion.value ?? {}),
        ...(nota.value.trim() ? { nota: nota.value.trim() } : {}),
      },
    )
    emit('entregado', resultado)
  } catch (fallo) {
    error.value =
      fallo instanceof ErrorApi ? fallo.message : 'No pudimos cerrar la entrega. Inténtalo otra vez.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('cerrar')">
    <div class="modal-sheet" role="dialog" aria-label="Contar la entrega">
      <div class="modal-handle" />
      <p class="modal-title">Entregar {{ pedido.folio }}</p>

      <p class="intro">
        Cuenta con el cliente lo que se queda. Lo que no acepte sigue en tu camión hasta el corte.
      </p>

      <ul class="renglones">
        <li v-for="renglon in renglones" :key="renglon.pedidoItemId">
          <div class="linea">
            <span class="nombre">{{ renglon.nombre }}</span>
            <div class="contador">
              <button
                type="button"
                class="paso"
                aria-label="Una menos"
                :disabled="renglon.cantidadEntregada <= 0"
                @click="ajustar(renglon, -1)"
              >
                −
              </button>
              <input
                v-model.number="renglon.cantidadEntregada"
                class="form-input cantidad"
                type="number"
                inputmode="numeric"
                min="0"
                :max="renglon.cantidadCargada"
                @change="limpiarMotivo(renglon)"
              />
              <button
                type="button"
                class="paso"
                aria-label="Una más"
                :disabled="renglon.cantidadEntregada >= renglon.cantidadCargada"
                @click="ajustar(renglon, 1)"
              >
                +
              </button>
              <span class="de">de {{ renglon.cantidadCargada }}</span>
            </div>
          </div>

          <!-- En cuanto sobra una pieza hay que decir por qué. -->
          <select
            v-if="renglon.cantidadEntregada < renglon.cantidadCargada"
            v-model="renglon.motivoDevolucion"
            class="select-input motivo"
          >
            <option :value="null">¿Por qué no se lo quedó?</option>
            <option v-for="m in MOTIVOS" :key="m.valor" :value="m.valor">{{ m.etiqueta }}</option>
          </select>
        </li>
      </ul>

      <p class="conteo">
        Se queda {{ piezasDelRecuento(renglones).entregadas }} pieza(s) · regresan
        {{ piezasDelRecuento(renglones).devueltas }}
        <template v-if="pedido.pago.aPagar > 0">
          · a cobrar hasta {{ dinero(pedido.pago.aPagar) }}
        </template>
      </p>

      <div class="evidencia">
        <label class="boton-foto" :class="{ deshabilitado: subiendo }">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            :disabled="subiendo"
            @change="adjuntarFoto"
          />
          {{ subiendo ? 'Subiendo…' : '📷 Foto de la entrega' }}
        </label>
        <img v-if="fotoUrl" :src="fotoUrl" class="miniatura" alt="Foto de la entrega" />
        <button
          v-if="fotoUrl"
          type="button"
          class="quitar"
          aria-label="Quitar la foto"
          @click="quitarFoto"
        >
          ✕
        </button>
        <span class="ubicacion">
          <template v-if="ubicacion">📍 Ubicación lista</template>
          <template v-else-if="buscandoUbicacion">📍 Buscando ubicación…</template>
          <template v-else>📍 Sin ubicación</template>
        </span>
      </div>

      <textarea
        v-model="nota"
        class="form-textarea"
        rows="2"
        maxlength="500"
        placeholder="Nota de la entrega (opcional)"
      />

      <p v-if="error" class="form-error">{{ error }}</p>

      <div class="modal-actions">
        <button type="button" class="btn-cancel" :disabled="enviando" @click="emit('cerrar')">
          Volver
        </button>
        <button
          type="button"
          class="btn-primary"
          :disabled="enviando || subiendo"
          @click="entregar"
        >
          {{
            enviando ? 'Cerrando…' : subiendo ? 'Esperando la foto…' : 'Confirmar entrega'
          }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.intro {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.45;
}

.renglones {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
}

.renglones li {
  background: var(--white);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  margin-bottom: 8px;
}

.linea {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.nombre {
  font-size: 12.5px;
  color: var(--ink);
  min-width: 0;
}

.contador {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.paso {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--line);
  background: var(--cream-2);
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 15px;
  color: var(--ink);
  cursor: pointer;
}

.paso:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.contador .cantidad {
  width: 52px;
  margin: 0;
  padding: 6px 4px;
  text-align: center;
  font-family: var(--font-heading);
  font-weight: 700;
}

.de {
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
}

.motivo {
  margin: 8px 0 0;
}

.conteo {
  margin: 0 0 12px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  color: var(--ink);
}

.evidencia {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.boton-foto {
  background: var(--white);
  border: 1.5px solid var(--line);
  border-radius: 11px;
  padding: 9px 12px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  color: var(--ink);
  cursor: pointer;
}

.boton-foto.deshabilitado {
  opacity: 0.55;
  cursor: not-allowed;
}

.boton-foto input {
  display: none;
}

.miniatura {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  object-fit: cover;
}

.quitar {
  background: var(--white);
  border: none;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  color: var(--terracotta);
  font-size: 12px;
  cursor: pointer;
}

.ubicacion {
  font-size: 11px;
  color: var(--muted);
}
</style>
