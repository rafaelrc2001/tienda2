<script setup lang="ts">
/**
 * El conteo físico de lo que baja del camión: por producto, lo cargado, lo
 * entregado y la devolución. Es el único momento en que alguien puede
 * contrastarlo contra la caja real, así que va agrupado por producto y no por
 * pedido: el mismo producto repetido en varios renglones no deja comparar.
 *
 * Sin fila de totales a propósito, como el inventario del camión de cada
 * entrega: sumar kilos con piezas daría un número que no significa nada.
 *
 * Con `contados` (Liquidación) suma dos columnas: «Devuelto», donde se captura
 * lo que de verdad baja —nunca más de la devolución—, y «Faltante», lo que no
 * bajó y se puede cobrar con «Generar pedido x faltante». Sin él (Historial)
 * solo se consulta. La columna del producto se queda fija y las cifras se
 * desplazan debajo: en el teléfono no caben todas.
 */
import { limitarDevuelto, piezasCapturadas } from './liquidacion'
import type { ConteoDeProducto } from '@/api/tipos'

defineProps<{ conteo: ConteoDeProducto[] }>()

/** Lo capturado por producto, como texto: vacío es «sin contar», no cero. */
const contados = defineModel<Record<string, string>>('contados')

/**
 * Se limpia y se topa al teclear. El campo se reescribe a mano: si el valor
 * topado es el mismo que ya había (4 → «45» → 4), Vue no ve cambio y dejaría
 * el «45» escrito.
 */
function capturar(producto: ConteoDeProducto, evento: Event): void {
  const campo = evento.target as HTMLInputElement
  const limpio = limitarDevuelto(campo.value, producto.devolucion)
  campo.value = limpio
  contados.value = { ...contados.value, [producto.productoId]: limpio }
}

/** Lo que falta de un producto ya contado; `null` mientras no se cuente. */
function faltante(producto: ConteoDeProducto): number | null {
  const contado = piezasCapturadas(contados.value?.[producto.productoId])
  return contado === null ? null : producto.devolucion - contado
}
</script>

<template>
  <div class="tabla-envoltorio">
    <table class="tabla lineal conteo">
      <thead>
        <tr>
          <th class="producto">Producto</th>
          <th class="num">Cargado</th>
          <th class="num">Entregado</th>
          <th class="num">Devolución</th>
          <template v-if="contados">
            <th class="num">Devuelto</th>
            <th class="num">Faltante</th>
          </template>
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
          <template v-if="contados">
            <td class="num">
              <!-- Sin devolución no hay nada que contar ni que pueda faltar. -->
              <input
                v-if="producto.devolucion > 0"
                class="form-input contado"
                :class="{ descuadra: (faltante(producto) ?? 0) > 0 }"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                autocomplete="off"
                enterkeyhint="next"
                placeholder="—"
                :aria-label="`Devuelto de ${producto.nombre}, máximo ${producto.devolucion}`"
                :value="contados[producto.productoId] ?? ''"
                @input="capturar(producto, $event)"
              />
              <span v-else class="sin-dato">—</span>
            </td>
            <td class="num">
              <strong v-if="(faltante(producto) ?? 0) > 0" class="falta">
                {{ faltante(producto) }}
              </strong>
              <span v-else-if="faltante(producto) === 0">0</span>
              <span v-else class="sin-dato">—</span>
            </td>
          </template>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/*
 * El nombre se lleva el espacio que sobra y, si no cabe, se parte en renglones
 * antes de encoger las cifras. Fijo a la izquierda: al desplazar la tabla, cada
 * cifra sigue junto a su producto.
 */
.conteo .producto {
  position: sticky;
  left: 0;
  z-index: 1;
  width: 99%;
  min-width: 120px;
  white-space: normal;
  font-weight: 600;
  background: var(--white);
  box-shadow: inset -1px 0 0 var(--line);
}

.conteo thead .producto {
  background: var(--cream-2);
  font-weight: 700;
}

.conteo > tbody > tr:hover > .producto {
  background: var(--cream-2);
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

/* 16px reales: con menos, Safari en iPhone amplía la página al enfocar el campo. */
.contado {
  width: 4.5rem;
  margin: 2px 0;
  padding: 4px 8px;
  text-align: right;
  font-size: 16px;
  font-weight: 700;
  background: var(--white);
}

.contado::placeholder {
  font-weight: 400;
  color: var(--muted);
}

.sin-dato {
  color: var(--muted);
}

/* Lo que falta es lo que se va a cobrar: en naranja, como lo que regresa. */
.falta {
  color: var(--orange-dark);
}

.contado.descuadra {
  border-color: var(--orange-dark);
  color: var(--orange-dark);
}
</style>
