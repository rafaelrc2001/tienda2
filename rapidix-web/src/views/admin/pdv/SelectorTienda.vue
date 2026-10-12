<script setup lang="ts">
/**
 * PDV → «¿En qué tienda vas a trabajar?».
 *
 * Es lo primero que se ve al entrar al PDV, siempre: cada tienda tiene su
 * turno, su inventario y sus cortes, y nada de eso se mezcla con lo de otra.
 * No se recuerda la última a propósito: elegirla es un toque, y equivocarse
 * de tienda es cobrar en la caja de otra.
 *
 * Cada tienda enseña cuántos pedidos para recoger tiene sin preparar: así se
 * sabe a cuál hay que entrar antes de elegirla.
 */
import type { PendientesPorTienda, Tienda } from '@/api/tipos'

defineProps<{ tiendas: Tienda[]; pendientes: PendientesPorTienda }>()
defineEmits<{ elegir: [tienda: Tienda] }>()
</script>

<template>
  <div class="selector-tienda">
    <h3>¿En qué tienda vas a trabajar?</h3>

    <div v-if="tiendas.length > 0" class="tabla-envoltorio">
      <table class="tabla">
        <thead>
          <tr>
            <th>Tienda</th>
            <th>Dirección</th>
            <th>Responsable</th>
            <th>Por preparar</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="tienda in tiendas" :key="tienda.id">
            <td>
              <span class="folio">{{ tienda.nombre }}</span>
            </td>
            <td>{{ tienda.direccion }}</td>
            <td>{{ tienda.responsable }}</td>
            <td>
              <span v-if="pendientes[tienda.id]" class="pastilla por-preparar">
                🔔 {{ pendientes[tienda.id] }} pedido(s)
              </span>
              <template v-else>—</template>
            </td>
            <td class="num">
              <button type="button" class="btn-primary entrar" @click="$emit('elegir', tienda)">
                Entrar
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else class="empty-block">
      Todavía no hay tiendas. Da de alta una en Configuración → Tiendas.
    </p>
  </div>
</template>

<style scoped>
h3 {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 15px;
  color: var(--ink);
  margin: 4px 0 12px;
}

.tabla {
  min-width: 600px;
}

.por-preparar {
  background: var(--rojo);
  color: var(--white);
}

.entrar {
  width: auto;
  padding: 0 18px;
}
</style>
