<script setup lang="ts">
/**
 * Configuración → Fiscal → Emisor: a nombre de quién pueden salir las facturas.
 *
 * Solo se mira. Cada emisor es una cuenta de factura.com cuyas llaves están en
 * el servidor (`FACTURACOM_*` la principal, `FACTURACOM_*_2` la segunda…), y
 * sus datos —RFC, nombre, régimen y CP— la API los lee de esa cuenta: son los
 * que de verdad quedan sellados en el CFDI. Antes se capturaban aquí a mano y
 * se podían separar de la cuenta real; por eso ya no hay formulario. Se
 * cambian en factura.com o en las variables del servidor.
 *
 * Qué emisor usa cada tienda se elige en Configuración → Tiendas.
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
        Las facturas salen con una de estas cuentas de factura.com. Cada tienda usa la suya
        (Configuración → Tiendas) y el punto de venta puede cambiarla al facturar; a domicilio sale
        con la principal. Sus datos se leen de cada cuenta: para cambiarlos, edítalos en
        factura.com.
      </p>

      <p v-if="datos.error" class="form-error">
        No pudimos leer alguna cuenta de factura.com: {{ datos.error }}
      </p>

      <div v-if="datos.emisores.length > 0" class="tabla-envoltorio">
        <table class="tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>RFC</th>
              <th>Régimen</th>
              <th>CP</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in datos.emisores" :key="e.rfc">
              <td>
                {{ e.nombre }}
                <span v-if="e.principal" class="principal">Principal</span>
              </td>
              <td class="rfc">{{ e.rfc }}</td>
              <td :class="{ demo: !e.regimen }">
                <template v-if="e.regimen">{{ e.regimen }} · {{ e.regimenNombre }}</template>
                <template v-else>No reconocido: revísalo en factura.com</template>
              </td>
              <td class="rfc" :class="{ demo: !e.cp }">{{ e.cp ?? 'Sin capturar' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="ayuda nota">
        Timbra con:
        <strong :class="{ demo: datos.modo === 'SIMULADO' }">{{ comoTimbra(datos) }}</strong>
      </p>

      <p v-if="datos.modo === 'SIMULADO'" class="ayuda">
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

.tabla .rfc {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.principal {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--cream-2);
  color: var(--terracotta);
  font-size: 10.5px;
  font-weight: 700;
}

.demo {
  color: var(--orange-dark);
}
</style>
