<script setup lang="ts">
/**
 * Productos → ventana «Inventario»: el saldo de bodega, de un vistazo (I-1).
 *
 * **Tabla de solo lectura, por diseño.** Dejar editar el saldo aquí sería
 * dejar que un cambio quede sin bitácora: quien lo miró después no tendría
 * forma de saber quién lo movió ni por qué. Para cambiarlo está Movimientos,
 * que obliga a decir ambas cosas.
 *
 * **Con una tienda elegida** muestra su inventario, el mismo que ve su PDV,
 * para saber qué le falta antes de mandarle una transferencia. La tercera
 * columna cambia de sentido: bodega tiene camiones («en ruta») y la tienda,
 * pedidos sin entregar que ya apartaron piezas («comprometido»). Los avisos y
 * el filtro miran siempre el apto para venta.
 */
import { computed, ref, watch } from 'vue'
import { ErrorApi, http } from '@/api/http'
import type { ExistenciaTienda, SaldoProducto } from '@/api/tipos'
import { UMBRAL_BAJO } from './etiquetas'
import SkeletonList from '@/components/SkeletonList.vue'
import SelectorTienda from '@/components/SelectorTienda.vue'

const props = defineProps<{ saldos: SaldoProducto[]; cargando: boolean }>()

type Filtro = 'todos' | 'bajos' | 'cero'

/** Un renglón de la tabla, venga de bodega o de una tienda. */
interface Fila {
  id: string
  nombre: string
  unidad: string
  categoria: string
  fisico: number
  apt: number
  /** En ruta (bodega) o comprometido (tienda). */
  tercera: number
  /** Solo en tiendas: el interruptor «Habilitar» apagado hace que salga agotado. */
  deshabilitado: boolean
}

const busqueda = ref('')
const filtro = ref<Filtro>('todos')

/** Vacío es bodega; si no, el id de la tienda. */
const tienda = ref('')
const existencias = ref<ExistenciaTienda[]>([])
const cargandoTienda = ref(false)
const errorTienda = ref('')
/** Al cambiar rápido de tienda, solo pinta la respuesta de la última petición. */
let peticion = 0

watch(tienda, async (id) => {
  const esta = ++peticion
  existencias.value = []
  errorTienda.value = ''
  if (!id) {
    cargandoTienda.value = false
    return
  }
  cargandoTienda.value = true
  try {
    const filas = await http.get<ExistenciaTienda[]>(`/admin/inventario/tiendas/${id}/inventario`)
    if (esta === peticion) existencias.value = filas
  } catch (fallo) {
    if (esta === peticion) {
      errorTienda.value =
        fallo instanceof ErrorApi ? fallo.message : 'No pudimos cargar el inventario de la tienda.'
    }
  } finally {
    if (esta === peticion) cargandoTienda.value = false
  }
})

const filas = computed<Fila[]>(() => {
  if (!tienda.value) {
    return props.saldos.map((s) => ({
      id: s.id,
      nombre: s.nombre,
      unidad: s.unidad,
      categoria: s.categoria,
      fisico: s.inventario,
      apt: s.aptInventario,
      tercera: s.inventarioEnRuta,
      deshabilitado: false,
    }))
  }
  return existencias.value.map((e) => ({
    id: e.productoId,
    nombre: e.nombre,
    unidad: e.unidad,
    categoria: e.categoria,
    fisico: e.cantidad,
    apt: e.disponible,
    tercera: e.comprometido,
    deshabilitado: !e.habilitado,
  }))
})

const cargandoFilas = computed(() => (tienda.value ? cargandoTienda.value : props.cargando))

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'bajos', etiqueta: 'Por acabarse' },
  { valor: 'cero', etiqueta: 'Sin existencia' },
]

/** Cómo se pinta el saldo de venta de una fila. */
function estado(fila: Fila): 'cero' | 'bajo' | 'ok' {
  if (fila.apt === 0) return 'cero'
  return fila.apt <= UMBRAL_BAJO ? 'bajo' : 'ok'
}

const visibles = computed<Fila[]>(() => {
  const termino = busqueda.value.trim().toLowerCase()
  return filas.value.filter((f) => {
    if (termino && !`${f.nombre} ${f.categoria}`.toLowerCase().includes(termino)) return false
    if (filtro.value === 'bajos') return estado(f) === 'bajo'
    if (filtro.value === 'cero') return f.apt === 0
    return true
  })
})

/** Cabecera: cuántos productos están en cada situación. */
const conteo = computed(() => ({
  cero: filas.value.filter((f) => f.apt === 0).length,
  bajos: filas.value.filter((f) => estado(f) === 'bajo').length,
}))
</script>

<template>
  <div class="ventana-inventario">
    <SelectorTienda v-model="tienda" modo="inventario" />

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

    <p v-if="errorTienda" class="form-error">{{ errorTienda }}</p>

    <div v-if="!cargandoFilas && !errorTienda" class="avisos">
      <span v-if="conteo.cero > 0" class="aviso cero">{{ conteo.cero }} sin existencia</span>
      <span v-if="conteo.bajos > 0" class="aviso bajo">{{ conteo.bajos }} por acabarse</span>
      <span v-if="conteo.cero + conteo.bajos === 0" class="aviso ok"> Todo en orden </span>
    </div>

    <SkeletonList v-if="cargandoFilas" :cantidad="4" />

    <div v-else-if="visibles.length > 0" class="tabla-scroll">
      <table class="tabla-inventario">
        <thead>
          <tr>
            <th class="col-producto">Producto</th>
            <th>Grupo</th>
            <th class="num">Inv.<br />físico</th>
            <th class="num">Apt.<br />venta</th>
            <th v-if="tienda" class="num">Compro&shy;metido</th>
            <th v-else class="num">En<br />ruta</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="fila in visibles" :key="fila.id">
            <th class="col-producto" scope="row">
              {{ fila.nombre }}
              <span class="unidad">{{ fila.unidad }}</span>
              <span
                v-if="fila.deshabilitado"
                class="deshabilitado"
                title="Interruptor «Habilitar» apagado en Productos"
              >
                Deshabilitado
              </span>
            </th>
            <td>{{ fila.categoria }}</td>
            <td class="num">{{ fila.fisico }}</td>
            <td class="num" :class="estado(fila)">{{ fila.apt }}</td>
            <td
              class="num"
              :class="{ vacio: fila.tercera === 0, apartado: !!tienda && fila.tercera > 0 }"
            >
              {{ fila.tercera }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else-if="!errorTienda" class="empty-block">
      {{
        filas.length > 0
          ? 'Ningún producto coincide con el filtro.'
          : tienda
            ? 'La tienda todavía no tiene inventario: se carga al aceptar una transferencia.'
            : 'Todavía no hay productos en el catálogo.'
      }}
    </p>

    <p v-if="tienda" class="nota">
      Es el inventario que ve la tienda en su <strong>PDV</strong>: sube cuando acepta una
      transferencia y baja cuando entrega un pedido. <em>Comprometido</em> son piezas de pedidos sin
      entregar que siguen en el anaquel pero ya no se pueden vender; <em>apt. venta</em> es lo que
      queda libre y el número para decidir si se le resurte.
    </p>
    <p v-else class="nota">
      El saldo no se edita aquí: se mueve en <strong>Movimientos</strong>, que deja constancia de
      quién lo movió y por qué. <em>Físico</em> es lo que hay en bodega; <em>apt. venta</em>, lo que
      el cliente puede comprar; <em>en ruta</em>, lo que va en los camiones. Al recolectar un pedido
      sus piezas salen del físico y pasan a en ruta; de ahí bajan al entregarse o vuelven al físico
      al regresar en el corte. Lo que va en ruta ya no cuenta en el físico.
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
  background: rgba(245, 124, 0, 0.12);
  color: var(--terracotta-dark);
}

.aviso.bajo {
  background: rgba(245, 124, 0, 0.18);
  color: var(--gold-dark);
}

.aviso.ok {
  background: rgba(76, 175, 80, 0.15);
  color: var(--sage);
}

/*
 * La tabla no desplaza dentro de su propia caja: una caja con scroll metida en
 * `.app-screen`, que también desplaza, hace que en el teléfono el dedo mueva a
 * ratos la tabla y a ratos la página, y la tabla parece flotar sobre el fondo.
 * Desplaza solo la pantalla y el encabezado se queda pegado arriba de ella.
 * `overflow: clip` recorta las esquinas redondas sin volverse contenedor de
 * scroll (con `hidden` el sticky se pegaría a la caja y no a la pantalla).
 */
.tabla-scroll {
  overflow: clip;
  background: var(--white);
  border-radius: 14px;
  box-shadow: var(--shadow);
}

/*
 * Sin scroll lateral, las cinco columnas tienen que caber en la columna del
 * móvil: anchos fijos, poco relleno y el nombre y el grupo parten línea.
 */
.tabla-inventario {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  table-layout: fixed;
  font-size: 12px;
}

.tabla-inventario .col-producto {
  width: 32%;
}

.tabla-inventario thead th:nth-child(2) {
  width: 23%;
}

.tabla-inventario th,
.tabla-inventario td {
  padding: 9px 6px;
  text-align: left;
  border-bottom: 1px solid var(--line);
  white-space: normal;
  overflow-wrap: anywhere;
  background: var(--white);
}

.tabla-inventario th:first-child,
.tabla-inventario td:first-child {
  padding-left: 12px;
}

.tabla-inventario th:last-child,
.tabla-inventario td:last-child {
  padding-right: 12px;
}

.tabla-inventario thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  overflow-wrap: normal;
  white-space: normal;
  line-height: 1.3;
  vertical-align: bottom;
  background: var(--cream);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

.tabla-inventario .col-producto {
  font-family: var(--font-heading);
  font-weight: 700;
  color: var(--ink);
  box-shadow: 1px 0 0 var(--line);
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

/* Casi todos los productos tienen cero en ruta: apagado, resalta el que sí lleva. */
td.num.vacio {
  color: var(--muted);
}

td.num.apartado {
  color: var(--gold);
  font-weight: 700;
}

.deshabilitado {
  display: inline-block;
  margin-top: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  color: var(--white);
  background: var(--terracotta);
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
