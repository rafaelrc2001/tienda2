<script setup lang="ts">
/**
 * Productos → ventana «Productos»: el catálogo (HU-A01).
 *
 * Alta, edición, switch de agotado, borrado con confirmación e importación
 * `.xlsx`. **El navegador no procesa el Excel**: el archivo se sube tal cual a
 * `POST /admin/productos/importar` y el backend lo lee. SheetJS desaparece.
 *
 * El saldo se enseña pero no se toca desde aquí: se mueve en la ventana de
 * Movimientos, que es la que deja bitácora.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { descargarArchivo, ErrorApi, http, subirArchivo } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import SubidorImagen from '@/components/SubidorImagen.vue'
import { nombreRol, ROLES } from './etiquetas'
import type { CategoriaConProductos, Escalon, Producto, RolProducto } from '@/api/tipos'

const props = defineProps<{ activa: boolean }>()

const ui = useUiStore()

const CAMPOS = ['nombre', 'categoria', 'unidad', 'precioCosto', 'precioVenta'] as const

interface FilaImportacion {
  fila: number
  estado: string
  motivo?: string
  producto?: string
}

interface ResumenImportacion {
  total: number
  creados: number
  actualizados: number
  errores: number
  /** Categorías que el archivo estrenó y quedaron en el catálogo. */
  categoriasNuevas: string[]
  filas: FilaImportacion[]
}

const grupos = ref<CategoriaConProductos[]>([])
const cargando = ref(true)
const busqueda = ref('')

/**
 * Catálogo de categorías, para sugerirlas en el alta. Se escriben igual que
 * siempre —el campo sigue siendo texto libre—, pero elegir una de la lista
 * evita estrenar "Lacteos" cuando ya existe "Lácteos".
 */
const categorias = ref<string[]>([])

const editando = ref<Producto | null>(null)
const modalAbierto = ref(false)
const guardando = ref(false)
const errores = ref<Record<string, string>>({})
const erroresGenerales = ref<string[]>([])

const importando = ref(false)
const resumen = ref<ResumenImportacion | null>(null)

/**
 * Una fila de la lista de precios (listas 2 y 3; la 1 es el precio de venta).
 * Las dos filas están siempre en el formulario; la que se deja vacía no viaja.
 */
interface FilaEscalon {
  piso: number | null
  precio: number | null
}

/** Dos listas por encima del precio de venta: las de la tabla del negocio. */
function filasEscalon(escalones: Escalon[] = []): FilaEscalon[] {
  return [0, 1].map((i) => ({
    piso: escalones[i]?.piso ?? null,
    precio: escalones[i]?.precio ?? null,
  }))
}

/** `v-model.number` deja `''` al vaciar un campo: eso es «sin valor». */
const sinValor = (v: number | string | null): boolean => v === null || v === ''

/**
 * Límite superior de la lista `indice` en el formulario (0 = precio de venta).
 *
 * No se captura: la API solo guarda el piso de cada lista, y el techo de una
 * es el piso de la siguiente menos uno. Pedirlo aparte permitiría escribir
 * rangos que se enciman o dejan huecos.
 */
function limiteSuperior(indice: number): string {
  const siguiente = formulario.value.escalones.slice(indice).find((f) => !sinValor(f.piso))
  return siguiente ? String(Number(siguiente.piso) - 1) : 'En adelante'
}

/** Las listas de un producto como «inferior–superior · precio», para el listado. */
function listaDePrecios(producto: Producto): { rango: string; precio: number }[] {
  const listas = [{ piso: 1, precio: producto.precioVenta }, ...producto.escalones]
  return listas.map((lista, i) => {
    const techo = listas[i + 1] ? listas[i + 1].piso - 1 : null
    let rango = `${lista.piso}+`
    if (techo !== null) rango = techo === lista.piso ? `${lista.piso}` : `${lista.piso}–${techo}`
    return { rango, precio: lista.precio }
  })
}

const formulario = ref({
  nombre: '',
  categoria: '',
  unidad: '',
  precioCosto: null as number | null,
  precioVenta: null as number | null,
  imagenUrl: '',
  rol: 'RUTINA' as RolProducto,
  escalones: filasEscalon(),
  aplicaCashback: true,
})

const gruposVisibles = computed<CategoriaConProductos[]>(() => {
  const termino = busqueda.value.trim().toLowerCase()
  if (!termino) return grupos.value
  return grupos.value
    .map((g) => ({
      categoria: g.categoria,
      productos: g.productos.filter(
        (p) =>
          p.nombre.toLowerCase().includes(termino) || p.categoria.toLowerCase().includes(termino),
      ),
    }))
    .filter((g) => g.productos.length > 0)
})

const totalProductos = computed(() =>
  grupos.value.reduce((suma, g) => suma + g.productos.length, 0),
)

onMounted(() => {
  void cargar()
  void cargarCategorias()
})

/**
 * Al volver a esta ventana se relee el catálogo. Un movimiento de bodega pudo
 * haber agotado un producto mientras tanto, y enseñar el estado de hace tres
 * clics es peor que no enseñarlo.
 */
watch(
  () => props.activa,
  (activa) => {
    if (activa) void cargar()
  },
)

async function cargar(): Promise<void> {
  cargando.value = true
  try {
    grupos.value = await http.get<CategoriaConProductos[]>('/admin/productos')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
}

/** Las sugerencias son un extra: si fallan, el alta sigue funcionando. */
async function cargarCategorias(): Promise<void> {
  try {
    categorias.value = await http.get<string[]>('/categorias')
  } catch {
    categorias.value = []
  }
}

function abrirAlta(): void {
  editando.value = null
  formulario.value = {
    nombre: '',
    categoria: '',
    unidad: '',
    precioCosto: null,
    precioVenta: null,
    imagenUrl: '',
    rol: 'RUTINA',
    escalones: filasEscalon(),
    aplicaCashback: true,
  }
  errores.value = {}
  erroresGenerales.value = []
  modalAbierto.value = true
}

function abrirEdicion(producto: Producto): void {
  editando.value = producto
  formulario.value = {
    nombre: producto.nombre,
    categoria: producto.categoria,
    unidad: producto.unidad,
    precioCosto: producto.precioCosto,
    precioVenta: producto.precioVenta,
    imagenUrl: producto.imagenUrl ?? '',
    rol: producto.rol,
    escalones: filasEscalon(producto.escalones),
    aplicaCashback: producto.aplicaCashback,
  }
  errores.value = {}
  erroresGenerales.value = []
  modalAbierto.value = true
}

/** Manda solo lo que tiene valor: los opcionales vacíos no viajan. */
function cuerpo(): Record<string, unknown> {
  const datos: Record<string, unknown> = {
    nombre: formulario.value.nombre.trim(),
    categoria: formulario.value.categoria.trim(),
    precioVenta: formulario.value.precioVenta ?? 0,
    rol: formulario.value.rol,
    aplicaCashback: formulario.value.aplicaCashback,
    // Siempre viaja, aunque sea vacía: es como se le quitan las listas a un
    // producto. Una fila a medias sí viaja, para que la API diga qué le falta.
    escalones: formulario.value.escalones
      .filter((f) => !sinValor(f.piso) || !sinValor(f.precio))
      .map((f) => ({
        piso: sinValor(f.piso) ? null : f.piso,
        precio: sinValor(f.precio) ? null : f.precio,
      })),
  }
  if (formulario.value.unidad.trim()) datos.unidad = formulario.value.unidad.trim()
  if (formulario.value.precioCosto !== null) datos.precioCosto = formulario.value.precioCosto
  if (formulario.value.imagenUrl.trim()) datos.imagenUrl = formulario.value.imagenUrl.trim()
  return datos
}

async function guardar(): Promise<void> {
  guardando.value = true
  errores.value = {}
  erroresGenerales.value = []
  try {
    if (editando.value) {
      await http.patch(`/admin/productos/${editando.value.id}`, cuerpo())
      ui.exito('Producto actualizado')
    } else {
      await http.post('/admin/productos', cuerpo())
      ui.exito('Producto creado')
    }
    modalAbierto.value = false
    await Promise.all([cargar(), cargarCategorias()])
  } catch (fallo) {
    if (fallo instanceof ErrorApi) {
      const { campos, generales } = fallo.porCampo(CAMPOS)
      errores.value = campos
      erroresGenerales.value = generales.length > 0 ? generales : [fallo.message]
    } else {
      ui.errorDeApi(fallo)
    }
  } finally {
    guardando.value = false
  }
}

/**
 * El switch se lee como «Habilitar», así que enciende cuando el producto **no**
 * está agotado. En la API el campo sigue llamándose `agotado` y se manda igual;
 * la vuelta se da aquí para que el interruptor diga lo que hace: encendido, se
 * vende. Al revés —encendido significando agotado— se presta a apagar un
 * producto creyendo que se está publicando.
 */
async function alternarHabilitado(producto: Producto): Promise<void> {
  const agotado = !producto.agotado
  try {
    await http.patch(`/admin/productos/${producto.id}/agotado`, { agotado })
    producto.agotado = agotado
  } catch (fallo) {
    ui.errorDeApi(fallo)
  }
}

async function eliminar(producto: Producto): Promise<void> {
  if (!confirm(`¿Eliminar «${producto.nombre}»? Esta acción no se puede deshacer.`)) return
  try {
    await http.delete(`/admin/productos/${producto.id}`)
    ui.exito('Producto eliminado')
    await cargar()
  } catch (fallo) {
    ui.errorDeApi(fallo)
  }
}

async function importar(evento: Event): Promise<void> {
  const entrada = evento.target as HTMLInputElement
  const archivo = entrada.files?.[0]
  if (!archivo) return

  importando.value = true
  resumen.value = null
  try {
    resumen.value = await subirArchivo<ResumenImportacion>(
      '/admin/productos/importar',
      'archivo',
      archivo,
    )
    ui.exito(
      `${resumen.value.creados} creados, ${resumen.value.actualizados} actualizados, ${resumen.value.errores} con error`,
    )
    await Promise.all([cargar(), cargarCategorias()])
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    importando.value = false
    // Permite volver a elegir el mismo archivo tras corregirlo.
    entrada.value = ''
  }
}

async function descargarPlantilla(): Promise<void> {
  try {
    await descargarArchivo('/admin/productos/plantilla', 'plantilla-productos.xlsx')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  }
}

const filasConError = computed(() => resumen.value?.filas.filter((f) => f.estado === 'error') ?? [])
</script>

<template>
  <div class="ventana-productos">
    <!-- Importación masiva -->
    <section class="admin-section">
      <h4>📥 Cargar por Excel</h4>
      <p class="columnas-plantilla">
        Columnas: <strong>Categoría</strong>, <strong>Producto</strong>,
        <strong>Unidad</strong>, <strong>Precio de costo</strong> y
        <strong>Precio de venta</strong>. Opcionales: <em>Imagen</em> (URL), <em>Piso 2</em>,
        <em>Precio 2</em>, <em>Piso 3</em> y <em>Precio 3</em> (precio por volumen) y
        <em>Aplica cashback</em> (Sí / No).
      </p>
      <label class="file-drop">
        <input type="file" accept=".xlsx" :disabled="importando" @change="importar" />
        {{ importando ? 'Subiendo el archivo…' : 'Elige un .xlsx con tus productos' }}
      </label>
      <button type="button" class="btn-secondary plantilla" @click="descargarPlantilla">
        Descargar plantilla
      </button>

      <div v-if="resumen" class="resumen-importacion">
        <div class="resumen-cifras">
          <div class="cifra"><span class="n">{{ resumen.total }}</span><span class="l">Filas</span></div>
          <div class="cifra"><span class="n">{{ resumen.creados }}</span><span class="l">Creados</span></div>
          <div class="cifra">
            <span class="n">{{ resumen.actualizados }}</span><span class="l">Actualizados</span>
          </div>
          <div class="cifra error">
            <span class="n">{{ resumen.errores }}</span><span class="l">Errores</span>
          </div>
        </div>

        <p v-if="resumen.categoriasNuevas.length > 0" class="categorias-nuevas">
          Categorías nuevas en el catálogo:
          <span v-for="nombre in resumen.categoriasNuevas" :key="nombre" class="mini-tag">{{
            nombre
          }}</span>
        </p>

        <ul v-if="filasConError.length > 0" class="filas-error">
          <li v-for="fila in filasConError" :key="fila.fila">
            <strong>Fila {{ fila.fila }}:</strong> {{ fila.motivo }}
          </li>
        </ul>
      </div>
    </section>

    <!-- Listado -->
    <div class="barra-superior">
      <input v-model="busqueda" class="form-input" type="search" placeholder="Buscar producto…" />
      <button type="button" class="btn-primary nuevo" @click="abrirAlta">+ Nuevo</button>
    </div>
    <p class="admin-list-count">{{ totalProductos }} productos</p>

    <SkeletonList v-if="cargando" :cantidad="3" />

    <template v-else-if="gruposVisibles.length > 0">
      <section v-for="grupo in gruposVisibles" :key="grupo.categoria">
        <h2 class="section-title"><span class="accent-bar" />{{ grupo.categoria }}</h2>

        <article v-for="producto in grupo.productos" :key="producto.id" class="fila-producto">
          <div class="media">
            <img v-if="producto.imagenUrl" :src="producto.imagenUrl" :alt="producto.nombre" />
            <template v-else>📦</template>
          </div>

          <div class="info">
            <p class="nombre">{{ producto.nombre }}</p>
            <p class="detalle">
              {{ dinero(producto.precioVenta) }}
              <span v-if="producto.unidad"> · {{ producto.unidad }}</span>
              · {{ nombreRol(producto.rol) }}
            </p>
            <p v-if="producto.escalones.length > 0 || !producto.aplicaCashback" class="detalle">
              <template v-if="producto.escalones.length > 0">
                <span v-for="lista in listaDePrecios(producto)" :key="lista.rango" class="escalon">
                  {{ lista.rango }} {{ producto.unidad }} · {{ dinero(lista.precio) }}
                </span>
              </template>
              <span v-if="!producto.aplicaCashback" class="escalon">Sin cashback</span>
            </p>
            <p class="saldo">
              {{ producto.aptInventario }} para venta
              <span v-if="producto.inventario !== producto.aptInventario">
                · {{ producto.inventario }} en físico</span
              >
            </p>
          </div>

          <label
            class="habilitar"
            :title="producto.agotado ? 'Agotado: no aparece a la venta' : 'Habilitado: a la venta'"
          >
            <span class="habilitar-texto">Habilitar</span>
            <span class="switch">
              <input
                type="checkbox"
                :checked="!producto.agotado"
                @change="alternarHabilitado(producto)"
              />
              <span class="slider-switch" />
            </span>
          </label>

          <button type="button" class="accion" aria-label="Editar" @click="abrirEdicion(producto)">
            ✏️
          </button>
          <button
            type="button"
            class="accion borrar"
            aria-label="Eliminar"
            @click="eliminar(producto)"
          >
            🗑
          </button>
        </article>
      </section>
    </template>

    <p v-else class="empty-block">
      {{ busqueda ? 'Ningún producto coincide con la búsqueda.' : 'Todavía no hay productos.' }}
    </p>

    <!-- Alta y edición -->
    <div v-if="modalAbierto" class="modal-overlay" @click.self="modalAbierto = false">
      <div class="modal-sheet" role="dialog">
        <div class="modal-handle" />
        <p class="modal-title">{{ editando ? '✏️ Editar producto' : '📦 Nuevo producto' }}</p>

        <p v-for="(mensaje, i) in erroresGenerales" :key="i" class="form-error">{{ mensaje }}</p>

        <label class="form-label" for="pr-nombre">Nombre</label>
        <input
          id="pr-nombre"
          v-model="formulario.nombre"
          class="form-input"
          :class="{ 'is-invalid': errores.nombre }"
        />
        <p v-if="errores.nombre" class="form-error">{{ errores.nombre }}</p>

        <label class="form-label" for="pr-categoria">Categoría</label>
        <input
          id="pr-categoria"
          v-model="formulario.categoria"
          class="form-input"
          list="pr-categorias"
          autocomplete="off"
          placeholder="Elige una o escribe una nueva"
          :class="{ 'is-invalid': errores.categoria }"
        />
        <datalist id="pr-categorias">
          <option v-for="nombre in categorias" :key="nombre" :value="nombre" />
        </datalist>
        <p v-if="errores.categoria" class="form-error">{{ errores.categoria }}</p>
        <p class="form-hint">
          Si la categoría no existe se da de alta sola en el catálogo.
        </p>

        <label class="form-label" for="pr-unidad">Unidad</label>
        <input id="pr-unidad" v-model="formulario.unidad" class="form-input" placeholder="kg" />

        <label class="form-label" for="pr-rol">Papel en la Tienda</label>
        <select id="pr-rol" v-model="formulario.rol" class="form-input">
          <option v-for="rol in ROLES" :key="rol.valor" :value="rol.valor">
            {{ rol.etiqueta }} — {{ rol.ayuda }}
          </option>
        </select>

        <label class="form-label" for="pr-costo">Precio de costo</label>
        <input
          id="pr-costo"
          v-model.number="formulario.precioCosto"
          class="form-input"
          type="number"
          step="0.01"
          min="0"
        />

        <!--
          La lista 1 es el precio de venta: se captura aquí y no en un campo aparte,
          para que el precio base y los de volumen se lean en una sola tabla.
        -->
        <p class="form-label">Lista de precios</p>
        <div class="lista-precios">
          <span class="lp-encabezado" />
          <span class="lp-encabezado">Límite inferior</span>
          <span class="lp-encabezado">Límite superior</span>
          <span class="lp-encabezado">Precio c/u</span>

          <span class="lp-lista">Lista 1</span>
          <input class="form-input" value="1" disabled aria-label="Lista 1: límite inferior" />
          <input
            class="form-input"
            :value="limiteSuperior(0)"
            disabled
            aria-label="Lista 1: límite superior"
          />
          <input
            id="pr-venta"
            v-model.number="formulario.precioVenta"
            class="form-input"
            :class="{ 'is-invalid': errores.precioVenta }"
            type="number"
            step="0.01"
            min="0"
            aria-label="Lista 1: precio de venta"
          />

          <template v-for="(fila, i) in formulario.escalones" :key="i">
            <span class="lp-lista">Lista {{ i + 2 }}</span>
            <input
              v-model.number="fila.piso"
              class="form-input"
              type="number"
              step="1"
              min="2"
              :placeholder="i === 0 ? '5' : '10'"
              :aria-label="`Lista ${i + 2}: límite inferior`"
            />
            <input
              class="form-input"
              :value="sinValor(fila.piso) ? '' : limiteSuperior(i + 1)"
              disabled
              :aria-label="`Lista ${i + 2}: límite superior`"
            />
            <input
              v-model.number="fila.precio"
              class="form-input"
              type="number"
              step="0.01"
              min="0"
              :aria-label="`Lista ${i + 2}: precio`"
            />
          </template>
        </div>
        <p v-if="errores.precioVenta" class="form-error">{{ errores.precioVenta }}</p>

        <div class="toggle-row">
          <div>
            <div class="t-lbl">Participa en el cashback</div>
            <div class="t-sub">Apagado, este producto no suma a la base del cashback.</div>
          </div>
          <label class="switch">
            <input v-model="formulario.aplicaCashback" type="checkbox" />
            <span class="slider-switch" />
          </label>
        </div>

        <label class="form-label">Imagen del producto</label>
        <SubidorImagen v-model="formulario.imagenUrl" carpeta="productos" />

        <div class="modal-actions">
          <button type="button" class="btn-cancel" @click="modalAbierto = false">Cancelar</button>
          <button type="button" class="btn-primary" :disabled="guardando" @click="guardar">
            {{ guardando ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-section {
  margin-bottom: 20px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--line);
}

.admin-section h4 {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 13px;
  color: var(--ink);
  margin: 0 0 10px;
}

.columnas-plantilla {
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.5;
  margin: 0 0 10px;
}

.columnas-plantilla strong {
  color: var(--ink);
  font-weight: 700;
}

.form-hint {
  font-size: 11.5px;
  color: var(--muted);
  margin: 4px 0 0;
}

/* Tabla de la lista de precios: la etiqueta de la lista y sus tres columnas. */
.lista-precios {
  display: grid;
  grid-template-columns: auto repeat(3, minmax(0, 1fr));
  gap: 6px 8px;
  align-items: center;
  margin: 8px 0 12px;
}

.lista-precios .form-input {
  margin-bottom: 0;
  min-width: 0;
}

.lista-precios .form-input:disabled {
  background: var(--cream-2);
  color: var(--muted);
}

.lp-encabezado {
  font-family: var(--font-heading);
  font-size: 10px;
  font-weight: 700;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.lp-lista {
  font-family: var(--font-heading);
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
}

.categorias-nuevas {
  font-size: 11.5px;
  color: var(--muted);
  margin: 12px 0 0;
}

.categorias-nuevas .mini-tag {
  margin: 0 0 0 4px;
}

.file-drop {
  display: block;
  border: 2px dashed var(--line);
  border-radius: 14px;
  padding: 18px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  background: var(--cream);
}

.file-drop input {
  display: none;
}

.plantilla {
  margin-top: 10px;
}

.resumen-importacion {
  margin-top: 14px;
}

.resumen-cifras {
  display: flex;
  gap: 8px;
}

.cifra {
  flex: 1;
  background: var(--cream);
  border-radius: 10px;
  padding: 8px 6px;
  text-align: center;
}

.cifra .n {
  display: block;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 16px;
  color: var(--terracotta-dark);
}

.cifra.error .n {
  color: var(--terracotta);
}

.cifra .l {
  display: block;
  font-size: 9px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-weight: 700;
  margin-top: 2px;
}

.filas-error {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  font-size: 11.5px;
  color: var(--ink);
  line-height: 1.5;
}

.filas-error li {
  background: var(--white);
  border-left: 3px solid var(--terracotta);
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;
}

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

.nuevo {
  flex-shrink: 0;
  height: 42px;
}

.admin-list-count {
  font-size: 11.5px;
  color: var(--sage);
  font-weight: 700;
  font-family: var(--font-heading);
  margin: 8px 0 0;
}

.section-title {
  margin-left: 0;
  margin-right: 0;
}

.fila-producto {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--white);
  border-radius: 14px;
  padding: 10px 12px;
  margin-bottom: 10px;
  box-shadow: var(--shadow);
}

.fila-producto .media {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: var(--cream-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
  overflow: hidden;
}

.fila-producto .media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.fila-producto .info {
  flex: 1;
  min-width: 0;
}

.nombre {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  color: var(--ink);
  margin: 0;
}

.detalle {
  font-size: 11px;
  color: var(--muted);
  margin: 2px 0 0;
}

.detalle .escalon {
  display: inline-block;
  background: var(--cream-2);
  border-radius: 5px;
  padding: 1px 5px;
  margin-right: 4px;
  font-weight: 700;
}

.saldo {
  font-size: 10.5px;
  color: var(--sage);
  font-weight: 700;
  font-family: var(--font-heading);
  margin: 2px 0 0;
}

/**
 * El switch va rotulado: suelto en la fila, entre un lápiz y un bote de basura,
 * no dice si enciende o apaga el producto. La palabra ocupa casi lo mismo que
 * el interruptor, así que la fila no se estrecha por ponerla.
 */
.habilitar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
  cursor: pointer;
}

.habilitar-texto {
  font-family: var(--font-heading);
  font-size: 9px;
  font-weight: 700;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.habilitar .switch {
  transform: scale(0.85);
}

.accion {
  background: var(--cream);
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  cursor: pointer;
  font-size: 14px;
  flex-shrink: 0;
}

.accion.borrar {
  background: var(--cream-2);
}
</style>
