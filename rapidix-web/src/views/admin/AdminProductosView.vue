<script setup lang="ts">
/**
 * Administración → Productos: una pantalla, tres ventanas.
 *
 * - **Productos** es el catálogo: qué se vende y a cuánto (HU-A01).
 * - **Inventario** es el saldo de bodega, de solo lectura.
 * - **Movimientos** es lo único que mueve ese saldo, y siempre con bitácora.
 *
 * El saldo lo carga esta pantalla y no cada ventana porque Inventario y
 * Movimientos leen exactamente el mismo dato: tenerlo en dos sitios sería
 * poder enseñar dos números distintos para el mismo producto.
 */
import { ref, watch } from 'vue'
import { http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import type { SaldoProducto } from '@/api/tipos'
import TabProductos from './productos/TabProductos.vue'
import TabInventario from './productos/TabInventario.vue'
import TabMovimientos from './productos/TabMovimientos.vue'

type Ventana = 'productos' | 'inventario' | 'movimientos'

const VENTANAS: { clave: Ventana; etiqueta: string }[] = [
  { clave: 'productos', etiqueta: 'Productos' },
  { clave: 'inventario', etiqueta: 'Inventario' },
  { clave: 'movimientos', etiqueta: 'Movimientos' },
]

const ui = useUiStore()

const ventana = ref<Ventana>('productos')
const saldos = ref<SaldoProducto[]>([])
const cargandoSaldos = ref(false)

/**
 * Ventanas ya abiertas alguna vez.
 *
 * Una ventana se monta la primera vez que se entra a ella —así el catálogo no
 * arrastra la carga del historial de bodega de quien nunca lo abre— y a partir
 * de ahí se queda montada: cambiar de pestaña no puede borrar las cantidades
 * que alguien llevaba capturadas.
 */
const abiertas = ref<Set<Ventana>>(new Set(['productos']))

async function cargarSaldos(): Promise<void> {
  cargandoSaldos.value = true
  try {
    saldos.value = await http.get<SaldoProducto[]>('/admin/inventario')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargandoSaldos.value = false
  }
}

/**
 * Al entrar a una ventana que enseña saldo se relee.
 *
 * Es lo que hace que tras registrar un movimiento se vea el saldo de después y
 * no el que estaba en pantalla al capturar: se releen los saldos, no se
 * parchean en memoria con lo que uno cree haber movido.
 */
watch(ventana, (actual) => {
  abiertas.value.add(actual)
  if (actual !== 'productos') void cargarSaldos()
})

/**
 * Tras registrar, se enseña el saldo ya movido (M-3). Recargarlo es cosa del
 * `watch` de arriba: aquí solo se cambia de ventana.
 */
function alRegistrar(): void {
  ventana.value = 'inventario'
}
</script>

<template>
  <div class="admin-productos">
    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <div class="subtab-row">
      <button
        v-for="v in VENTANAS"
        :key="v.clave"
        type="button"
        class="subtab"
        :class="{ active: ventana === v.clave }"
        @click="ventana = v.clave"
      >
        {{ v.etiqueta }}
      </button>
    </div>

    <TabProductos v-show="ventana === 'productos'" :activa="ventana === 'productos'" />
    <TabInventario
      v-if="abiertas.has('inventario')"
      v-show="ventana === 'inventario'"
      :saldos="saldos"
      :cargando="cargandoSaldos && saldos.length === 0"
    />
    <TabMovimientos
      v-if="abiertas.has('movimientos')"
      v-show="ventana === 'movimientos'"
      :saldos="saldos"
      @registrado="alRegistrar"
    />
  </div>
</template>

<style scoped>
.admin-productos {
  padding: 12px 18px 24px;
}

.admin-back-inline {
  display: inline-block;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  padding: 0 0 12px;
  text-decoration: none;
}

/* La fila de pestañas ya trae margen lateral para la app de cliente; aquí la
   pantalla pone el suyo. */
.subtab-row {
  margin: 0 0 14px;
}
</style>
