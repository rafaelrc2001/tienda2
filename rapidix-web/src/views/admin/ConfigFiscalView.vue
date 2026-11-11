<script setup lang="ts">
/**
 * Configuración → Fiscal → Emisor: a nombre de quién sale toda factura.
 *
 * Solo se mira. El emisor es la cuenta de factura.com de las llaves del
 * servidor (`FACTURACOM_*`), y sus datos —RFC, nombre, régimen y CP— la API
 * los lee de esa cuenta: son los que de verdad quedan sellados en el CFDI.
 * Antes se capturaban aquí a mano y se podían separar de la cuenta real; por
 * eso ya no hay formulario. Se cambian en factura.com o en las variables del
 * servidor.
 */
import { onMounted, ref } from 'vue'
import { http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import SkeletonList from '@/components/SkeletonList.vue'
import type { EmisorServidor } from '@/api/tipos'
import PestanasFiscal from './fiscal/PestanasFiscal.vue'

const ui = useUiStore()

const datos = ref<EmisorServidor | null>(null)
const cargando = ref(true)

onMounted(async () => {
  try {
    datos.value = await http.get<EmisorServidor>('/admin/configuracion/emisor')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
})

function comoTimbra(d: EmisorServidor): string {
  if (d.modo === 'SIMULADO') return 'Demostración (sin validez fiscal)'
  return d.entorno === 'PRODUCCION' ? 'factura.com · producción' : 'factura.com · sandbox'
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin/configuracion" class="admin-back-inline">
      ← Volver a Configuración
    </RouterLink>

    <PestanasFiscal activa="datos" />

    <SkeletonList v-if="cargando" :cantidad="1" />

    <template v-else-if="datos">
      <p class="ayuda">
        Todas las facturas —Mis pedidos, Finanzas, el punto de venta y la factura global— salen con
        la cuenta de factura.com del servidor. Sus datos se leen de esa cuenta: para cambiarlos,
        edítalos en factura.com.
      </p>

      <p v-if="datos.error" class="form-error">
        No pudimos leer la cuenta de factura.com: {{ datos.error }}
      </p>

      <div v-if="datos.emisor" class="tabla-envoltorio">
        <table class="tabla lineal">
          <tbody>
            <tr>
              <th>Nombre</th>
              <td>{{ datos.emisor.nombre }}</td>
            </tr>
            <tr>
              <th>RFC</th>
              <td class="rfc">{{ datos.emisor.rfc }}</td>
            </tr>
            <tr>
              <th>Régimen</th>
              <td :class="{ demo: !datos.emisor.regimen }">
                <template v-if="datos.emisor.regimen">
                  {{ datos.emisor.regimen }} · {{ datos.emisor.regimenNombre }}
                </template>
                <template v-else>No reconocido: revisa el régimen en factura.com</template>
              </td>
            </tr>
            <tr>
              <th>CP (lugar de expedición)</th>
              <td class="rfc" :class="{ demo: !datos.emisor.cp }">
                {{ datos.emisor.cp ?? 'Sin capturar en factura.com' }}
              </td>
            </tr>
            <tr>
              <th>Timbra con</th>
              <td :class="{ demo: datos.modo === 'SIMULADO' }">{{ comoTimbra(datos) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="datos.modo === 'SIMULADO'" class="ayuda nota">
        El servidor no tiene las variables <code>FACTURACOM_API_KEY</code>,
        <code>FACTURACOM_SECRET_KEY</code> y <code>FACTURACOM_SERIE</code>: se factura con el emisor
        de pruebas y las facturas no tienen validez fiscal.
      </p>
    </template>
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

.ayuda {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--muted);
}

.ayuda.nota {
  margin-top: 12px;
}

.tabla th {
  width: 40%;
  text-align: left;
}

.tabla .rfc {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.demo {
  color: var(--orange-dark);
}
</style>
