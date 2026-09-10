<script setup lang="ts">
/**
 * «Repetir mi última compra» (HU-04 y HU-05).
 *
 * Sale arriba del catálogo con lo que pidió la última vez, **a precio de hoy**:
 * las cantidades son las de aquel pedido, los importes los de ahora. Un
 * producto que ya no se puede servir se enseña tachado y no suma.
 *
 * Se pliega solo al bajar por el catálogo y se vuelve a abrir al subir; el
 * botón de descartar lo quita hasta la próxima visita.
 */
import { computed } from 'vue'
import { dinero, fecha } from '@/utils/formato'
import type { UltimoPedido } from '@/api/tipos'

const props = defineProps<{
  pedido: UltimoPedido
  /** Plegado a una sola línea, pero todavía a la vista. */
  colapsado: boolean
  /** Mientras se llena el carrito y se navega al checkout. */
  ocupado: boolean
}>()

const emit = defineEmits<{
  (e: 'usar'): void
  (e: 'descartar'): void
  (e: 'expandir'): void
}>()

const disponibles = computed(() => props.pedido.items.filter((i) => i.disponible))

/** Dirección de aquel pedido, en una línea. Es a donde volvería a ir. */
const direccion = computed(() => {
  const datos = props.pedido.direccion
  if (!datos) return ''
  const partes = ['calle', 'colonia', 'cp', 'ciudad']
    .map((clave) => datos[clave])
    .filter((valor): valor is string => typeof valor === 'string' && valor.trim() !== '')
  return partes.join(', ')
})
</script>

<template>
  <section class="fast-track" :class="{ colapsado }">
    <button v-if="colapsado" type="button" class="resumen" @click="emit('expandir')">
      <span class="etiqueta">Repetir tu última compra</span>
      <span class="importe">{{ dinero(pedido.subtotal) }}</span>
    </button>

    <template v-else>
      <header class="cabecera">
        <div>
          <p class="titulo">¿Repetimos tu última compra?</p>
          <p class="folio">{{ pedido.folio }} · {{ fecha(pedido.creadoEn) }}</p>
        </div>
        <span class="total">{{ dinero(pedido.subtotal) }}</span>
      </header>

      <ul class="lineas">
        <li v-for="item in pedido.items" :key="item.productoId" :class="{ ida: !item.disponible }">
          <span class="cantidad">{{ item.cantidad }}</span>
          <span class="nombre">{{ item.nombre }}</span>
          <span class="precio">{{ dinero(item.importe) }}</span>
        </li>
      </ul>

      <p v-for="(aviso, i) in pedido.avisos" :key="i" class="aviso">{{ aviso }}</p>

      <p v-if="direccion" class="direccion">Se entregaría en {{ direccion }}</p>

      <div class="acciones">
        <button
          type="button"
          class="btn-primary"
          :disabled="ocupado || disponibles.length === 0"
          @click="emit('usar')"
        >
          {{ ocupado ? 'Preparando…' : 'Sí, usar este pedido' }}
        </button>
        <button type="button" class="btn-cancel" @click="emit('descartar')">
          No, crear uno nuevo
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.fast-track {
  margin: 4px 18px 12px;
  background: var(--white);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
  border-left: 4px solid var(--gold);
  padding: 12px 14px;
  overflow: hidden;
}

.fast-track.colapsado {
  padding: 0;
}

.resumen {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: transparent;
  border: none;
  padding: 11px 14px;
  cursor: pointer;
  text-align: left;
}

.resumen .etiqueta {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  color: var(--ink);
}

.resumen .importe {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  color: var(--terracotta-dark);
}

.cabecera {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.titulo {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  color: var(--ink);
  margin: 0;
}

.folio {
  font-size: 10.5px;
  color: var(--muted);
  margin: 2px 0 0;
  font-weight: 600;
}

.total {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 15px;
  color: var(--terracotta-dark);
  flex-shrink: 0;
}

.lineas {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
}

.lineas li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11.5px;
  color: var(--ink);
  padding: 3px 0;
}

.lineas li.ida {
  color: var(--muted);
  text-decoration: line-through;
}

.lineas .cantidad {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 11px;
  min-width: 18px;
  color: var(--sage);
}

.lineas .nombre {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lineas .precio {
  font-weight: 700;
  flex-shrink: 0;
}

.aviso {
  font-size: 10.5px;
  color: var(--terracotta-dark);
  margin: 6px 0 0;
  line-height: 1.4;
}

.direccion {
  font-size: 10.5px;
  color: var(--muted);
  margin: 8px 0 0;
  line-height: 1.4;
}

.acciones {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.acciones button {
  flex: 1;
  font-size: 11.5px;
  padding: 10px 6px;
}
</style>
