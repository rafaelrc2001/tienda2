<script setup lang="ts">
/**
 * Administración → Finanzas → Cortes: la lista de lo que cada repartidor trae
 * de su entrega y de lo que cada cajero entrega de su turno del punto de venta.
 *
 * Aquí solo se ve en qué va cada corte. Aceptarlo se hace en su propia
 * pantalla, que abre «Ver corte»: el de ruta —devolución, efectivo y entrega
 * aceptada— en `FinanzasCorteView`, y el de caja, que es solo dinero, en
 * `FinanzasCorteCajaView`.
 *
 * Los dos vienen de endpoints distintos, cada uno del módulo de su dominio, y
 * se juntan aquí en una sola tabla (`filas`), del más reciente al más viejo.
 *
 * La pestaña vive en la URL (`?filtro=`) para que al volver del corte se
 * regrese a la misma.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import PestanasFinanzas from './finanzas/PestanasFinanzas.vue'
import { centavos, esperaDelCorte, faltanteDe, type EsperaDelCorte } from './rutas/liquidacion'
import type { Corte, FiltroCortes, ListadoCortes, ListadoCortesDeCaja, TurnoPdv } from '@/api/tipos'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()

const PESTANAS: { filtro: FiltroCortes; titulo: string }[] = [
  { filtro: 'por-aceptar', titulo: 'Por aceptar' },
  { filtro: 'con-adeudo', titulo: 'Con adeudo' },
  { filtro: 'cerrados', titulo: 'Cerrados' },
]

const VACIO: Record<FiltroCortes, string> = {
  'por-aceptar': 'No hay cortes esperando que se acepten. 🎉',
  'con-adeudo': 'Nadie debe dinero de sus cortes.',
  cerrados: 'Todavía no se ha cerrado ningún corte.',
}

/** Lo que sigue en cada corte, dicho como el botón que hay que pulsar. */
const SIGUE: Record<EsperaDelCorte, string> = {
  devolucion: 'Aceptar devolución',
  dinero: 'Aceptar dinero',
  entrega: 'Entrega aceptada',
  abono: 'Aceptar dinero',
}

const filtro = computed<FiltroCortes>(() => {
  const pedido = route.query.filtro
  return PESTANAS.some((p) => p.filtro === pedido) ? (pedido as FiltroCortes) : 'por-aceptar'
})
const cortes = ref<Corte[]>([])
const turnos = ref<TurnoPdv[]>([])
const conteos = ref<Record<FiltroCortes, number> | null>(null)
const cargando = ref(true)

/** Cambiar de pestaña rápido deja respuestas viejas en el aire: gana la última. */
let peticion = 0

async function cargar(): Promise<void> {
  const numero = ++peticion
  cargando.value = true
  try {
    const query = { filtro: filtro.value }
    const [deRuta, deCaja] = await Promise.all([
      http.get<ListadoCortes>('/admin/finanzas/cortes', { query }),
      http.get<ListadoCortesDeCaja>('/admin/finanzas/cortes-de-caja', { query }),
    ])
    if (numero !== peticion) return
    cortes.value = deRuta.cortes
    turnos.value = deCaja.turnos
    // Contar renglones no es sumar dinero: cada pestaña dice cuántos hay de los dos.
    conteos.value = {
      'por-aceptar': deRuta.conteos['por-aceptar'] + deCaja.conteos['por-aceptar'],
      'con-adeudo': deRuta.conteos['con-adeudo'] + deCaja.conteos['con-adeudo'],
      cerrados: deRuta.conteos.cerrados + deCaja.conteos.cerrados,
    }
  } catch (fallo) {
    if (numero === peticion) ui.errorDeApi(fallo)
  } finally {
    if (numero === peticion) cargando.value = false
  }
}

onMounted(() => cargar())
// `filtro` se lee de la ruta: la pestaña cambia la URL y la URL vuelve a pedir.
watch(filtro, () => void cargar())

function elegir(nuevo: FiltroCortes): void {
  if (nuevo === filtro.value) return
  void router.replace({ query: nuevo === 'por-aceptar' ? {} : { filtro: nuevo } })
}

/** El corte, en su pantalla; lleva la pestaña para regresar a ella. */
function enlaceA(path: string) {
  return { path, query: filtro.value === 'por-aceptar' ? {} : { filtro: filtro.value } }
}

function sigue(corte: Corte): string {
  const espera = esperaDelCorte(corte)
  if (espera) return SIGUE[espera]
  return corte.estado === 'CERRADO' ? '—' : 'Espera al repartidor'
}

/** En caja no hay mercancía ni entrega que aceptar: o hay dinero esperando, o no. */
function sigueEnCaja(turno: TurnoPdv): string {
  if (turno.corte?.estado === 'CERRADO') return '—'
  return turno.corte?.dineroPorAceptar != null ? 'Aceptar dinero' : 'Espera al cajero'
}

/** Un renglón de la tabla, venga de una ruta o de una caja. */
interface Fila {
  clave: string
  folio: string
  enlace: ReturnType<typeof enlaceA>
  quien: string
  pedidos: number
  calculado: number
  declarado: number
  /** `null` mientras Finanzas no acepte el dinero: tampoco hay adeudo que medir. */
  recibido: number | null
  adeudo: number
  sigue: string
  cerradoEn: string
}

const filas = computed<Fila[]>(() => {
  const deRuta = cortes.value.map<Fila>((corte) => ({
    clave: `ruta-${corte.id}`,
    folio: corte.entrega?.folio ?? 'Sin folio',
    enlace: enlaceA(`/admin/finanzas/cortes/${corte.id}`),
    quien: `🛵 ${corte.repartidorNombre}`,
    pedidos: corte.pedidos,
    calculado: corte.montoCalculado,
    declarado: corte.montoDeclarado,
    recibido: corte.recibidoEn ? corte.montoRecibido : null,
    adeudo: faltanteDe(corte),
    sigue: sigue(corte),
    cerradoEn: corte.cerradoEn,
  }))
  const deCaja = turnos.value.map<Fila>((turno) => ({
    clave: `caja-${turno.id}`,
    folio: turno.folio,
    enlace: enlaceA(`/admin/finanzas/cortes/caja/${turno.id}`),
    quien: `🏪 ${turno.cajero} · ${turno.tienda.nombre}`,
    pedidos: turno.totales.cobrados,
    calculado: turno.totales.efectivo,
    declarado: turno.efectivoDeclarado ?? 0,
    recibido: turno.corte?.recibidoEn ? turno.corte.efectivoRecibido : null,
    adeudo: Math.max(0, centavos(turno.corte?.saldoPendiente ?? 0)),
    sigue: sigueEnCaja(turno),
    cerradoEn: turno.cerradoEn ?? turno.abiertoEn,
  }))
  // Fechas ISO: ordenarlas como texto es ordenarlas en el tiempo.
  return [...deRuta, ...deCaja].sort((a, b) => b.cerradoEn.localeCompare(a.cerradoEn))
})
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin" class="admin-back-inline">← Volver al menú</RouterLink>

    <PestanasFinanzas activa="cortes" />

    <div class="subtab-row" role="tablist">
      <button
        v-for="p in PESTANAS"
        :key="p.filtro"
        type="button"
        role="tab"
        class="subtab"
        :class="{ active: filtro === p.filtro }"
        :aria-selected="filtro === p.filtro"
        @click="elegir(p.filtro)"
      >
        {{ p.titulo }}<template v-if="conteos"> · {{ conteos[p.filtro] }}</template>
      </button>
    </div>

    <SkeletonList v-if="cargando" :cantidad="3" />

    <div v-else-if="filas.length > 0" class="tabla-envoltorio">
      <table class="tabla lineal">
        <thead>
          <tr>
            <th>Corte</th>
            <th>Quién entrega</th>
            <th class="num">Pedidos</th>
            <th class="num">Dice el sistema</th>
            <th class="num">Declaró</th>
            <th class="num">Aceptado</th>
            <th class="num">Adeudo</th>
            <th>Sigue</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="fila in filas" :key="fila.clave">
            <td>
              <span class="folio">{{ fila.folio }}</span>
              <div class="enlaces">
                <RouterLink :to="fila.enlace" class="enlace">Ver corte</RouterLink>
              </div>
            </td>
            <td class="nombre">{{ fila.quien }}</td>
            <td class="num">{{ fila.pedidos }}</td>
            <td class="num importe">{{ dinero(fila.calculado) }}</td>
            <td class="num">{{ dinero(fila.declarado) }}</td>
            <td class="num">{{ fila.recibido !== null ? dinero(fila.recibido) : '—' }}</td>
            <td class="num importe" :class="{ falta: fila.adeudo > 0 }">
              <template v-if="fila.recibido !== null">
                {{ fila.adeudo > 0 ? dinero(fila.adeudo) : 'Sin adeudo' }}
              </template>
              <template v-else>—</template>
            </td>
            <td class="sigue">{{ fila.sigue }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else class="empty-block">{{ VACIO[filtro] }}</p>
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

.subtab-row {
  margin: 0 0 12px;
}

.tabla {
  min-width: 760px;
}

.tabla > tbody > tr > td.nombre {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 12.5px;
  white-space: nowrap;
}

.tabla > tbody > tr > td.falta {
  color: var(--rojo);
}

.tabla > tbody > tr > td.sigue {
  font-family: var(--font-heading);
  font-weight: 700;
  white-space: nowrap;
}
</style>
