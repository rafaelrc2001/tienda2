<script setup lang="ts">
/**
 * Cupones → Métricas (Word 4.9.5).
 *
 * Todo se calcula en vivo en el backend desde los cupones realmente emitidos
 * y usados: aquí no se suma nada, se pinta lo que devuelve
 * `GET /admin/cupones/metricas`.
 */
import { onMounted, ref } from 'vue'
import { http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero } from '@/utils/formato'
import type { MetricasCupones } from '@/api/tipos'

const ui = useUiStore()

const metricas = ref<MetricasCupones | null>(null)
const cargando = ref(true)
const expirando = ref(false)

onMounted(cargar)

async function cargar(): Promise<void> {
  cargando.value = true
  try {
    metricas.value = await http.get<MetricasCupones>('/admin/cupones/metricas')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
}

/**
 * El job de vencimientos corre solo cada día a las 3:00. Este botón existe
 * para poder verificarlo sin esperar.
 */
async function expirarVencidos(): Promise<void> {
  expirando.value = true
  try {
    const { expirados } = await http.post<{ expirados: number }>('/admin/cupones/expirar-vencidos')
    ui.exito(
      expirados === 0 ? 'No había cupones vencidos por marcar.' : `${expirados} cupones marcados como vencidos`,
    )
    await cargar()
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    expirando.value = false
  }
}
</script>

<template>
  <div class="pantalla">
    <RouterLink to="/admin/cupones" class="admin-back-inline">← Volver a Cupones</RouterLink>

    <p v-if="cargando" class="empty-block">Cargando…</p>

    <template v-else-if="metricas">
      <!-- Resumen -->
      <div class="tarjeta-resumen">
        <div class="destacado">
          <p class="lbl">Utilización global</p>
          <p class="valor">{{ metricas.resumen.porcentajeUtilizacion }}%</p>
          <p class="sub">
            {{ metricas.resumen.utilizados }} de {{ metricas.resumen.generados }} cupones emitidos
          </p>
        </div>

        <div class="rejilla">
          <div class="celda">
            <span class="n">{{ metricas.resumen.generados }}</span><span class="l">Generados</span>
          </div>
          <div class="celda">
            <span class="n">{{ metricas.resumen.utilizados }}</span><span class="l">Utilizados</span>
          </div>
          <div class="celda">
            <span class="n">{{ metricas.resumen.activos }}</span><span class="l">Activos</span>
          </div>
          <div class="celda">
            <span class="n">{{ metricas.resumen.vencidos }}</span><span class="l">Vencidos</span>
          </div>
          <div class="celda">
            <span class="n">{{ metricas.resumen.cancelados }}</span><span class="l">Cancelados</span>
          </div>
          <div class="celda">
            <span class="n">{{ metricas.resumen.clientesConCupon }}</span>
            <span class="l">Con cupón</span>
          </div>
        </div>

        <p class="descuento-total">
          Descuento otorgado: <strong>{{ dinero(metricas.resumen.descuentoTotalOtorgado) }}</strong>
        </p>
      </div>

      <!-- Desglose por tipo -->
      <h2 class="section-title"><span class="accent-bar" />Por tipo</h2>

      <div class="tabla-envoltorio">
        <table class="tabla">
          <thead>
            <tr>
              <th>Cupón</th>
              <th class="num">Gen.</th>
              <th class="num">Util.</th>
              <th class="num">%</th>
              <th class="num">Descuento</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="fila in metricas.porTipo" :key="`${fila.origen}-${fila.sourceCode}`">
              <td>
                <span class="titulo-fila">{{ fila.titulo }}</span>
                <span class="codigo-fila">{{ fila.origen }} · {{ fila.sourceCode }}</span>
              </td>
              <td class="num">{{ fila.generados }}</td>
              <td class="num">{{ fila.utilizados }}</td>
              <td class="num">{{ fila.porcentajeUtilizacion }}%</td>
              <td class="num">{{ dinero(fila.descuentoOtorgado) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="metricas.porTipo.length === 0" class="empty-block">
        Todavía no se ha emitido ningún cupón.
      </p>

      <div class="mantenimiento">
        <button type="button" class="btn-secondary" :disabled="expirando" @click="expirarVencidos">
          {{ expirando ? 'Procesando…' : 'Marcar vencidos ahora' }}
        </button>
        <p class="nota">
          El barrido de vencimientos corre solo cada día a las 3:00. Esto lo ejecuta a mano.
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pantalla {
  padding: 12px 18px 24px;
}

.admin-back-inline {
  display: inline-block;
  color: var(--terracotta-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12.5px;
  padding: 0 0 14px;
  text-decoration: none;
}

.tarjeta-resumen {
  background: var(--white);
  border-radius: 16px;
  padding: 16px;
  box-shadow: var(--shadow);
}

.destacado {
  text-align: center;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 14px;
}

.destacado .lbl {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
}

.destacado .valor {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 34px;
  color: var(--terracotta-dark);
  margin: 4px 0 2px;
}

.destacado .sub {
  font-size: 11.5px;
  color: var(--muted);
  margin: 0;
}

.rejilla {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.celda {
  background: var(--cream);
  border-radius: 10px;
  padding: 10px 6px;
  text-align: center;
}

.celda .n {
  display: block;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 16px;
  color: var(--ink);
}

.celda .l {
  display: block;
  font-size: 9px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-weight: 700;
  margin-top: 2px;
}

.descuento-total {
  font-size: 12.5px;
  color: var(--ink);
  text-align: center;
  margin: 14px 0 0;
}

.descuento-total strong {
  font-family: var(--font-heading);
  color: var(--sage);
}

.section-title {
  margin-left: 0;
  margin-right: 0;
}

/* La tabla se desplaza dentro de su caja: la página nunca en horizontal. */
.tabla-envoltorio {
  overflow-x: auto;
  background: var(--white);
  border-radius: 14px;
  box-shadow: var(--shadow);
}

.tabla {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  min-width: 420px;
}

.tabla th {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 9.5px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}

.tabla td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  color: var(--ink);
  vertical-align: top;
}

.tabla tr:last-child td {
  border-bottom: none;
}

.tabla .num {
  text-align: right;
  white-space: nowrap;
  font-weight: 600;
}

.titulo-fila {
  display: block;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
}

.codigo-fila {
  display: block;
  font-size: 10px;
  color: var(--muted);
  margin-top: 2px;
}

.mantenimiento {
  margin-top: 18px;
}

.nota {
  font-size: 10.5px;
  color: var(--muted);
  line-height: 1.45;
  margin: 8px 0 0;
}
</style>
