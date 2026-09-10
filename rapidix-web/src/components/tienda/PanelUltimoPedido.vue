<script setup lang="ts">
/**
 * «Repite tu última compra, en un solo click» (HU-04 y HU-05).
 *
 * Sale arriba del catálogo con lo que pidió la última vez, **a precio de hoy**:
 * las cantidades son las de aquel pedido, los importes los de ahora. Un
 * producto que ya no se puede servir se enseña tachado y no suma.
 *
 * Reproduce tal cual el panel del ecommerce anterior: renglones bajos y
 * apretados, letra de cuerpo, total al pie y dos botones chicos. Por eso no
 * lleva folio, fecha ni dirección. De aquel panel se toma la forma, no los
 * colores: todo sale de la paleta de Rapidix (`tokens.css`). Además de la flecha, se pliega solo al
 * bajar por el catálogo; «No, crear uno nuevo» lo quita hasta la próxima visita.
 */
import { computed } from 'vue'
import { dinero } from '@/utils/formato'
import type { UltimoPedido } from '@/api/tipos'

const props = defineProps<{
  pedido: UltimoPedido
  /** Plegado a la cabecera, pero todavía a la vista. */
  colapsado: boolean
  /** Mientras se llena el carrito y se navega al checkout. */
  ocupado: boolean
}>()

const emit = defineEmits<{
  (e: 'usar'): void
  (e: 'descartar'): void
  (e: 'expandir'): void
  (e: 'contraer'): void
}>()

const disponibles = computed(() => props.pedido.items.filter((i) => i.disponible))

function alternar(): void {
  if (props.colapsado) emit('expandir')
  else emit('contraer')
}
</script>

<template>
  <section class="fast-track" :class="{ colapsado }">
    <button type="button" class="cabecera" :aria-expanded="!colapsado" @click="alternar">
      <svg class="rayo" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z" />
      </svg>
      <span class="titulo">Repite tu última compra, en un solo click</span>
      <svg
        class="flecha"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.6"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <template v-if="!colapsado">
      <ul class="lineas">
        <li v-for="item in pedido.items" :key="item.productoId" :class="{ ida: !item.disponible }">
          <span class="nombre">{{ item.cantidad }}× {{ item.nombre }}</span>
          <span class="precio">{{ dinero(item.importe) }}</span>
        </li>
      </ul>

      <!-- Solo aparecen cuando algo del pedido ya no se puede servir. -->
      <p v-for="(aviso, i) in pedido.avisos" :key="i" class="aviso">{{ aviso }}</p>

      <div class="total">
        <span>Total productos</span>
        <span class="importe">{{ dinero(pedido.subtotal) }}</span>
      </div>

      <div class="acciones">
        <button
          type="button"
          class="usar"
          :disabled="ocupado || disponibles.length === 0"
          @click="emit('usar')"
        >
          {{ ocupado ? 'Preparando…' : 'Sí, usar este pedido' }}
        </button>
        <button type="button" class="nuevo" @click="emit('descartar')">
          No, crear uno nuevo
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.fast-track {
  --separador: color-mix(in srgb, var(--ink) 10%, transparent);

  margin: 2px 18px 8px;
  background: var(--white);
  border: 1px solid var(--line);
  border-radius: 6px;
  font-family: var(--font-body);
  color: var(--ink);
  overflow: hidden;
}

.cabecera {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  padding: 6px 10px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: var(--ink);
}

.rayo {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  fill: var(--terracotta);
}

.titulo {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 13px;
}

/* Abierto apunta hacia abajo, como en el diseño; plegado gira para invitar a abrir. */
.flecha {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  transition: transform 0.18s ease;
}

.colapsado .flecha {
  transform: rotate(-90deg);
}

.lineas {
  list-style: none;
  margin: 0;
  padding: 0;
}

.lineas li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px solid var(--separador);
  padding: 3px 10px;
  font-size: 11px;
  line-height: 1.3;
}

.lineas li.ida {
  color: var(--muted);
  text-decoration: line-through;
}

.lineas .nombre {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lineas .precio {
  color: var(--muted);
  flex-shrink: 0;
}

.aviso {
  border-top: 1px solid var(--separador);
  padding: 3px 10px;
  margin: 0;
  font-size: 10.5px;
  line-height: 1.35;
  color: var(--terracotta-dark);
}

.total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px solid var(--separador);
  padding: 5px 10px 4px;
  font-weight: 700;
  font-size: 10.5px;
  text-transform: uppercase;
}

.total .importe {
  font-size: 12.5px;
  color: var(--terracotta);
}

.acciones {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 2px 6px 6px;
}

.acciones button {
  font-family: inherit;
  font-weight: 500;
  font-size: 11px;
  line-height: 1.2;
  border-radius: 4px;
  padding: 5px 6px;
  cursor: pointer;
}

/* El dorado y el texto café son los de `.btn-primary`, en tamaño chico. */
.usar {
  background: linear-gradient(180deg, var(--gold) 0%, var(--gold-dark) 100%);
  color: #3b2a00;
  font-weight: 700;
  border: 1px solid var(--gold-dark);
}

.usar:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.nuevo {
  background: var(--white);
  color: var(--ink);
  border: 1px solid var(--line);
}
</style>
