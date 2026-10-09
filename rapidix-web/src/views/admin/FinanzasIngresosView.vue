<script setup lang="ts">
/**
 * Administración → Finanzas → Ingresos: el libro del dinero que Finanzas
 * aceptó. Cada renglón nació al aceptar algo —el dinero de un reparto, lo que
 * un repartidor entregó después contra su adeudo, o el pago de una cuenta por
 * cobrar— y no se crea, edita ni borra desde aquí: la pantalla solo consulta.
 *
 * El **total lo da la API**, sumado sobre el rango entero. Aquí no se suma:
 * la lista viaja con tope y la suma de lo que se ve saldría corta sin avisar.
 *
 * Las fechas son días del negocio (`AAAA-MM-DD`), no instantes: dónde empieza
 * el día lo decide la API con su zona horaria. Sin fechas contesta el día de
 * hoy y dice cuál fue, y con eso se rellenan los campos.
 */
import { onMounted, ref } from 'vue'
import { http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fecha, nombreMetodoPago } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import PestanasFinanzas from './finanzas/PestanasFinanzas.vue'
import type { ConceptoIngreso, Ingreso, ListadoIngresos } from '@/api/tipos'

const ui = useUiStore()

const CONCEPTOS: { valor: ConceptoIngreso | ''; titulo: string }[] = [
  { valor: '', titulo: 'Todos' },
  { valor: 'ENTREGA', titulo: 'Entregas de ruta' },
  { valor: 'CXC', titulo: 'Cuentas por cobrar' },
  { valor: 'PDV', titulo: 'Cortes de caja' },
]

const NOMBRE_CONCEPTO: Record<ConceptoIngreso, string> = {
  ENTREGA: 'Entrega de ruta',
  CXC: 'Cuenta por cobrar',
  PDV: 'Corte de caja',
}

/** Vacías hasta la primera respuesta, que dice qué día es hoy para el negocio. */
const desde = ref('')
const hasta = ref('')
const concepto = ref<ConceptoIngreso | ''>('')

const ingresos = ref<Ingreso[]>([])
const total = ref(0)
const cuantos = ref(0)
const cargando = ref(true)

/** Cambiar un filtro tras otro deja respuestas viejas en el aire: gana la última. */
let peticion = 0

async function cargar(): Promise<void> {
  const numero = ++peticion
  cargando.value = true
  try {
    const respuesta = await http.get<ListadoIngresos>('/admin/finanzas/ingresos', {
      query: {
        desde: desde.value || undefined,
        hasta: hasta.value || undefined,
        concepto: concepto.value || undefined,
      },
    })
    if (numero !== peticion) return
    ingresos.value = respuesta.ingresos
    total.value = respuesta.total
    cuantos.value = respuesta.cuantos
    // El rango que de verdad se consultó: sin fechas es hoy, y así queda escrito.
    desde.value = respuesta.desde
    hasta.value = respuesta.hasta
  } catch (fallo) {
    if (numero === peticion) ui.errorDeApi(fallo)
  } finally {
    if (numero === peticion) cargando.value = false
  }
}

onMounted(cargar)

/**
 * Un rango al revés no se manda: se mueve la otra punta al día que se acaba de
 * elegir, que es lo que quiso decir quien lo eligió.
 */
function alCambiarFecha(cual: 'desde' | 'hasta'): void {
  if (desde.value && hasta.value && desde.value > hasta.value) {
    if (cual === 'desde') hasta.value = desde.value
    else desde.value = hasta.value
  }
  void cargar()
}

/** Borrar las fechas vuelve a «hoy», que es lo que contesta la API sin ellas. */
function verHoy(): void {
  desde.value = ''
  hasta.value = ''
  void cargar()
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <PestanasFinanzas activa="ingresos" />

    <!-- Bloque crema y campos blancos: se ve dónde se escribe. -->
    <div class="filtros">
      <div class="campo">
        <label class="form-label" for="ingresos-desde">Desde</label>
        <input
          id="ingresos-desde"
          v-model="desde"
          class="form-input"
          type="date"
          :max="hasta || undefined"
          @change="alCambiarFecha('desde')"
        />
      </div>
      <div class="campo">
        <label class="form-label" for="ingresos-hasta">Hasta</label>
        <input
          id="ingresos-hasta"
          v-model="hasta"
          class="form-input"
          type="date"
          :min="desde || undefined"
          @change="alCambiarFecha('hasta')"
        />
      </div>
      <div class="campo">
        <label class="form-label" for="ingresos-concepto">Concepto</label>
        <select id="ingresos-concepto" v-model="concepto" class="form-input" @change="cargar">
          <option v-for="c in CONCEPTOS" :key="c.valor" :value="c.valor">{{ c.titulo }}</option>
        </select>
      </div>
      <button type="button" class="btn-secondary hoy" @click="verHoy">Hoy</button>
    </div>

    <SkeletonList v-if="cargando" :cantidad="4" />

    <template v-else>
      <!-- El total del rango entero, tal como lo sumó la API: una tarjeta como las de Rutas. -->
      <div class="total">
        <span class="total-titulo">Total:</span>
        <strong class="total-monto">{{ dinero(total) }}</strong>
      </div>

      <div v-if="ingresos.length > 0" class="tabla-envoltorio">
        <table class="tabla lineal">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Concepto</th>
              <th>Folio</th>
              <th>Método</th>
              <th>Aceptó</th>
              <th class="num">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ingreso in ingresos" :key="ingreso.id">
              <td class="fecha">{{ fecha(ingreso.creadoEn) }}</td>
              <td>
                {{ NOMBRE_CONCEPTO[ingreso.concepto] ?? ingreso.concepto }}
                <span v-if="ingreso.nota" class="sub">{{ ingreso.nota }}</span>
              </td>
              <td>
                <span class="folio">{{ ingreso.referencia }}</span>
              </td>
              <td>{{ nombreMetodoPago(ingreso.metodo) }}</td>
              <td>{{ ingreso.registradoPorNombre }}</td>
              <td class="num importe">{{ dinero(ingreso.monto) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty-block">No hay ingresos en ese periodo.</p>

      <!-- La lista tiene tope; el total no. Se dice para que nadie sume renglones. -->
      <p v-if="cuantos > ingresos.length" class="tope">
        Se muestran los {{ ingresos.length }} más recientes de {{ cuantos }}. El total sí es de
        todos; acorta el periodo para verlos uno por uno.
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
  padding: 0 0 8px;
  text-decoration: none;
}

/* Dos columnas iguales: las fechas arriba, el concepto y «Hoy» abajo.
   `minmax(0, 1fr)` y no `1fr`: si no, el campo de fecha del iPhone empuja la
   rejilla fuera del bloque. */
.filtros {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: end;
  gap: 10px 12px;
  background: var(--cream-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  margin-bottom: 12px;
}

.campo {
  min-width: 0;
}

.campo .form-label {
  margin-top: 0;
}

.campo .form-input {
  display: block;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  margin: 0;
  background: var(--white);
}

/* Safari en iPhone pinta la fecha con su propio ancho y centrada, y se salía
   del bloque: sin su apariencia nativa obedece el ancho del campo. */
.campo input[type='date'] {
  -webkit-appearance: none;
  appearance: none;
}

.campo input[type='date']::-webkit-date-and-time-value {
  text-align: left;
}

/* Del alto del campo de al lado, no más. */
.hoy {
  width: 100%;
}

/* La misma tarjeta verde que los KPIs de una entrega. */
.total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  background: var(--verde-dark);
  color: var(--white);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  margin-bottom: 12px;
}

.total-titulo {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  opacity: 0.85;
}

.total-monto {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 22px;
  white-space: nowrap;
}

.tabla {
  min-width: 640px;
}

.tabla .fecha {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.tope {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--muted);
}
</style>
