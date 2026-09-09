<script setup lang="ts">
/**
 * Productos → ventana «Inventario»: el saldo de bodega, de un vistazo (I-1).
 *
 * **Tabla de solo lectura, por diseño.** Dejar editar el saldo aquí sería
 * dejar que un cambio quede sin bitácora: quien lo miró después no tendría
 * forma de saber quién lo movió ni por qué. Para cambiarlo está Movimientos,
 * que obliga a decir ambas cosas.
 */
import { computed, ref } from 'vue'
import type { SaldoProducto } from '@/api/tipos'
import { UMBRAL_BAJO } from './etiquetas'
import SkeletonList from '@/components/SkeletonList.vue'

const props = defineProps<{ saldos: SaldoProducto[]; cargando: boolean }>()

type Filtro = 'todos' | 'bajos' | 'cero' | 'descuadre'

const busqueda = ref('')
const filtro = ref<Filtro>('todos')

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'bajos', etiqueta: 'Por acabarse' },
  { valor: 'cero', etiqueta: 'Sin existencia' },
  { valor: 'descuadre', etiqueta: 'Con descuadre' },
]

/** Cómo se pinta el saldo de venta de una fila. */
function estado(saldo: SaldoProducto): 'cero' | 'bajo' | 'ok' {
  if (saldo.aptInventario === 0) return 'cero'
  return saldo.aptInventario <= UMBRAL_BAJO ? 'bajo' : 'ok'
}

const visibles = computed<SaldoProducto[]>(() => {
  const termino = busqueda.value.trim().toLowerCase()
  return props.saldos.filter((s) => {
    if (termino && !`${s.nombre} ${s.categoria}`.toLowerCase().includes(termino)) return false
    if (filtro.value === 'bajos') return estado(s) === 'bajo'
    if (filtro.value === 'cero') return s.aptInventario === 0
    if (filtro.value === 'descuadre') return s.diferencia !== 0
    return true
  })
})

/** Cabecera: cuántos productos están en cada situación. */
const conteo = computed(() => ({
  cero: props.saldos.filter((s) => s.aptInventario === 0).length,
  bajos: props.saldos.filter((s) => estado(s) === 'bajo').length,
  descuadre: props.saldos.filter((s) => s.diferencia !== 0).length,
}))
</script>

<template>
  <div class="ventana-inventario">
    <div class="barra-superior">
      <input
        v-model="busqueda"
        class="form-input"
        type="search"
        placeholder="Buscar en el inventario…"
      />
      <select v-model="filtro" class="select-input">
        <option v-for="f in FILTROS" :key="f.valor" :value="f.valor">{{ f.etiqueta }}</option>
      </select>
    </div>

    <div v-if="!cargando" class="avisos">
      <span v-if="conteo.cero > 0" class="aviso cero">{{ conteo.cero }} sin existencia</span>
      <span v-if="conteo.bajos > 0" class="aviso bajo">{{ conteo.bajos }} por acabarse</span>
      <span v-if="conteo.descuadre > 0" class="aviso descuadre">
        {{ conteo.descuadre }} con descuadre
      </span>
      <span v-if="conteo.cero + conteo.bajos + conteo.descuadre === 0" class="aviso ok">
        Todo en orden
      </span>
    </div>

    <SkeletonList v-if="cargando" :cantidad="4" />

    <div v-else-if="visibles.length > 0" class="tabla-scroll">
      <table class="tabla-inventario">
        <thead>
          <tr>
            <th class="col-producto">Producto</th>
            <th>Grupo</th>
            <th class="num">Inventario (físico)</th>
            <th class="num">Apt. venta</th>
            <th class="num">Diferencia</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="saldo in visibles" :key="saldo.id">
            <th class="col-producto" scope="row">
              {{ saldo.nombre }}
              <span class="unidad">{{ saldo.unidad }}</span>
            </th>
            <td>{{ saldo.categoria }}</td>
            <td class="num">{{ saldo.inventario }}</td>
            <td class="num" :class="estado(saldo)">{{ saldo.aptInventario }}</td>
            <td class="num" :class="{ descuadre: saldo.diferencia !== 0 }">
              {{ saldo.diferencia }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else class="empty-block">
      {{
        saldos.length === 0
          ? 'Todavía no hay productos en el catálogo.'
          : 'Ningún producto coincide con el filtro.'
      }}
    </p>

    <p class="nota">
      El saldo no se edita aquí: se mueve en <strong>Movimientos</strong>, que deja constancia de
      quién lo movió y por qué. <em>Físico</em> es lo que hay en bodega; <em>apt. venta</em>, lo que
      el cliente puede comprar.
    </p>
  </div>
</template>

<style scoped>
.barra-superior {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.barra-superior .form-input {
  flex: 1;
  min-width: 0;
  margin-bottom: 0;
}

.barra-superior .select-input {
  width: 150px;
  flex-shrink: 0;
  margin-bottom: 0;
}

.avisos {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0 12px;
}

.aviso {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 3px 9px;
  border-radius: 8px;
  background: var(--cream-2);
  color: var(--muted);
}

.aviso.cero {
  background: rgba(193, 68, 14, 0.12);
  color: var(--terracotta-dark);
}

.aviso.bajo {
  background: rgba(244, 180, 0, 0.18);
  color: var(--gold-dark);
}

.aviso.descuadre {
  background: var(--cream-2);
  color: var(--navy);
}

.aviso.ok {
  background: rgba(110, 143, 93, 0.15);
  color: var(--sage);
}

/*
 * La tabla se sale de la columna en un móvil: se desplaza dentro de su propia
 * caja, con el encabezado y la columna del producto fijos para no perder de
 * vista de qué fila es el número que se está leyendo.
 */
.tabla-scroll {
  overflow: auto;
  max-height: 62vh;
  background: var(--white);
  border-radius: 14px;
  box-shadow: var(--shadow);
}

.tabla-inventario {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  font-size: 12px;
}

.tabla-inventario th,
.tabla-inventario td {
  padding: 9px 12px;
  text-align: left;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
  background: var(--white);
}

.tabla-inventario thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--cream);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

.tabla-inventario .col-producto {
  position: sticky;
  left: 0;
  z-index: 1;
  font-family: var(--font-heading);
  font-weight: 700;
  color: var(--ink);
  box-shadow: 1px 0 0 var(--line);
}

.tabla-inventario thead .col-producto {
  z-index: 3;
}

.unidad {
  display: block;
  font-family: var(--font-body);
  font-weight: 400;
  font-size: 10px;
  color: var(--muted);
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

td.num.cero {
  color: var(--terracotta);
  font-weight: 700;
}

td.num.bajo {
  color: var(--gold-dark);
  font-weight: 700;
}

td.num.descuadre {
  color: var(--navy);
  font-weight: 700;
}

.nota {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.55;
  margin: 12px 0 0;
}

.nota strong {
  color: var(--ink);
}
</style>
