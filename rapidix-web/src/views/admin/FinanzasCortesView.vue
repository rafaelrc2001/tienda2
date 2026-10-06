<script setup lang="ts">
/**
 * Administración → Finanzas → Cortes de ruta: la lista de lo que cada
 * repartidor trae de su entrega.
 *
 * Aquí solo se ve en qué va cada corte. Aceptarlo —devolución, efectivo y
 * entrega aceptada— se hace en su propia pantalla (`FinanzasCorteView`), que
 * abre «Ver corte», igual que una entrega o una liquidación en Rutas.
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
import { esperaDelCorte, faltanteDe, type EsperaDelCorte } from './rutas/liquidacion'
import type { Corte, FiltroCortes, ListadoCortes } from '@/api/tipos'

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
  'con-adeudo': 'Ningún repartidor debe dinero de sus cortes.',
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
const conteos = ref<Record<FiltroCortes, number> | null>(null)
const cargando = ref(true)

/** Cambiar de pestaña rápido deja respuestas viejas en el aire: gana la última. */
let peticion = 0

async function cargar(): Promise<void> {
  const numero = ++peticion
  cargando.value = true
  try {
    const respuesta = await http.get<ListadoCortes>('/admin/finanzas/cortes', {
      query: { filtro: filtro.value },
    })
    if (numero !== peticion) return
    cortes.value = respuesta.cortes
    conteos.value = respuesta.conteos
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
function enlaceDe(corte: Corte) {
  return {
    path: `/admin/finanzas/cortes/${corte.id}`,
    query: filtro.value === 'por-aceptar' ? {} : { filtro: filtro.value },
  }
}

function sigue(corte: Corte): string {
  const espera = esperaDelCorte(corte)
  if (espera) return SIGUE[espera]
  return corte.estado === 'CERRADO' ? '—' : 'Espera al repartidor'
}
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

    <div v-else-if="cortes.length > 0" class="tabla-envoltorio">
      <table class="tabla lineal">
        <thead>
          <tr>
            <th>Reparto</th>
            <th>Repartidor</th>
            <th class="num">Pedidos</th>
            <th class="num">Dice el sistema</th>
            <th class="num">Declaró</th>
            <th class="num">Aceptado</th>
            <th class="num">Adeudo</th>
            <th>Sigue</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="corte in cortes" :key="corte.id">
            <td>
              <span class="folio">{{ corte.entrega?.folio ?? 'Sin folio' }}</span>
              <div class="enlaces">
                <RouterLink :to="enlaceDe(corte)" class="enlace">Ver corte</RouterLink>
              </div>
            </td>
            <td class="nombre">🛵 {{ corte.repartidorNombre }}</td>
            <td class="num">{{ corte.pedidos }}</td>
            <td class="num importe">{{ dinero(corte.montoCalculado) }}</td>
            <td class="num">{{ dinero(corte.montoDeclarado) }}</td>
            <td class="num">
              {{ corte.montoRecibido !== null ? dinero(corte.montoRecibido) : '—' }}
            </td>
            <td class="num importe" :class="{ falta: faltanteDe(corte) > 0 }">
              <template v-if="corte.recibidoEn">
                {{ faltanteDe(corte) > 0 ? dinero(faltanteDe(corte)) : 'Sin adeudo' }}
              </template>
              <template v-else>—</template>
            </td>
            <td class="sigue">{{ sigue(corte) }}</td>
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
