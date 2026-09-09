<script setup lang="ts">
/**
 * Subida de imágenes por URL firmada.
 *
 * Tres pasos: se pide la firma a `POST /uploads/firma`, se hace `PUT` del
 * archivo a la URL que devuelve, y se guarda la `urlPublica`.
 *
 * A dónde apunta esa URL lo decide la API según el entorno —al bucket S3 si
 * está configurado, y si no a ella misma, que guarda la imagen en su base de
 * datos—, y aquí no hay que distinguirlos: los tres pasos son los mismos.
 *
 * **Degradación explícita:** si la firma responde 503 se avisa y el formulario
 * se sigue pudiendo guardar con emoji. No es un error que bloquee.
 */
import { computed, ref } from 'vue'
import { ErrorApi, http, subirAUrlFirmada } from '@/api/http'

const props = withDefaults(
  defineProps<{
    /** URL ya guardada, si la hay. */
    modelValue: string
    /** Las dos únicas carpetas que acepta la API. */
    carpeta: 'productos' | 'recetas'
    /** Emoji de reserva, para explicar la alternativa cuando no hay subida. */
    emoji?: string
  }>(),
  { emoji: '' },
)

const emit = defineEmits<{ (e: 'update:modelValue', url: string): void }>()

const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp']
const TAMANO_MAXIMO_BYTES = 5 * 1024 * 1024

const subiendo = ref(false)
const error = ref('')
/** true cuando la API dice que el almacenamiento no está configurado. */
const noDisponible = ref(false)

const tieneImagen = computed(() => props.modelValue.trim().length > 0)

async function elegir(evento: Event): Promise<void> {
  const entrada = evento.target as HTMLInputElement
  const archivo = entrada.files?.[0]
  entrada.value = ''
  if (!archivo) return

  error.value = ''

  // Se comprueba antes de gastar la firma; la API valida lo mismo.
  if (!TIPOS_PERMITIDOS.includes(archivo.type)) {
    error.value = 'Usa una imagen JPG, PNG o WebP.'
    return
  }
  if (archivo.size > TAMANO_MAXIMO_BYTES) {
    error.value = 'La imagen no puede pesar más de 5 MB.'
    return
  }

  subiendo.value = true
  try {
    const firma = await http.post<{
      urlSubida: string
      urlPublica: string
      clave: string
      expiraEnSegundos: number
    }>('/uploads/firma', {
      carpeta: props.carpeta,
      contentType: archivo.type,
      tamanoBytes: archivo.size,
    })

    await subirAUrlFirmada(firma.urlSubida, archivo)
    emit('update:modelValue', firma.urlPublica)
  } catch (fallo) {
    if (fallo instanceof ErrorApi && fallo.estado === 503) {
      // El almacén de imágenes no responde: se explica y se sigue con emoji.
      noDisponible.value = true
      error.value = 'La subida de imágenes no está disponible ahora mismo.'
    } else if (fallo instanceof ErrorApi) {
      error.value = fallo.message
    } else {
      error.value = 'No pudimos subir la imagen. Inténtalo de nuevo.'
    }
  } finally {
    subiendo.value = false
  }
}

function quitar(): void {
  emit('update:modelValue', '')
  error.value = ''
}
</script>

<template>
  <div class="subidor">
    <div class="fila">
      <label class="boton-subir" :class="{ deshabilitado: subiendo || noDisponible }">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          :disabled="subiendo || noDisponible"
          @change="elegir"
        />
        {{ subiendo ? 'Subiendo…' : '📷 Adjuntar imagen' }}
      </label>

      <div class="vista-previa">
        <img v-if="tieneImagen" :src="modelValue" alt="Vista previa" />
        <span v-else-if="emoji" class="emoji">{{ emoji }}</span>
        <span v-else class="vacio">Sin imagen</span>
      </div>

      <button v-if="tieneImagen" type="button" class="quitar" aria-label="Quitar imagen" @click="quitar">
        ✕
      </button>
    </div>

    <p v-if="error" class="form-error">{{ error }}</p>

    <p v-if="noDisponible" class="nota">
      Puedes guardar igual: se usará el emoji como imagen. Inténtalo de nuevo más tarde.
    </p>
  </div>
</template>

<style scoped>
.subidor {
  margin-bottom: 10px;
}

.fila {
  display: flex;
  align-items: center;
  gap: 10px;
}

.boton-subir {
  flex-shrink: 0;
  background: var(--cream-2);
  border: 1.5px solid var(--line);
  border-radius: 11px;
  padding: 10px 14px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  color: var(--ink);
  cursor: pointer;
}

.boton-subir.deshabilitado {
  opacity: 0.55;
  cursor: not-allowed;
}

.boton-subir input {
  display: none;
}

.vista-previa {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background: var(--cream-2);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.vista-previa img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.emoji {
  font-size: 26px;
}

.vacio {
  font-size: 9px;
  color: var(--muted);
  text-align: center;
  line-height: 1.2;
  padding: 0 4px;
}

.quitar {
  background: var(--cream-2);
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  color: var(--terracotta);
  font-size: 13px;
  cursor: pointer;
  flex-shrink: 0;
}

.nota {
  font-size: 10.5px;
  color: var(--muted);
  line-height: 1.45;
  margin: 6px 0 0;
}
</style>
