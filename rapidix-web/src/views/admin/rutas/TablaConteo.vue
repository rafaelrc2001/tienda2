<script setup lang="ts">
/**
 * El conteo físico de lo que baja del camión: por producto, lo cargado, lo
 * entregado y la devolución. Es el único momento en que alguien puede
 * contrastarlo contra la caja real, así que va agrupado por producto y no por
 * pedido: el mismo producto repetido en varios renglones no deja comparar.
 *
 * Sin fila de totales a propósito, como el inventario del camión de cada
 * entrega: sumar kilos con piezas daría un número que no significa nada.
 */
import type { ConteoDeProducto } from '@/api/tipos'

defineProps<{ conteo: ConteoDeProducto[] }>()
</script>

<template>
  <div class="tabla-envoltorio">
    <table class="tabla lineal conteo">
      <thead>
        <tr>
          <th>Producto</th>
          <th class="num">Cargado</th>
          <th class="num">Entregado</th>
          <th class="num">Devolución</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="producto in conteo" :key="producto.productoId">
          <td class="producto">
            {{ producto.nombre }} <span class="unidad">{{ producto.unidad }}</span>
          </td>
          <td class="num">{{ producto.cargado }}</td>
          <td class="num">{{ producto.entregado }}</td>
          <td class="num">
            <strong :class="{ regresa: producto.devolucion > 0 }">{{ producto.devolucion }}</strong>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* El nombre se lleva el espacio que sobra; las numéricas, solo el suyo. */
.conteo .producto {
  width: 99%;
  font-weight: 600;
}

.unidad {
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
}

/* Lo que regresa es lo que hay que contar al bajar: en naranja. */
.regresa {
  color: var(--orange-dark);
}
</style>
