<script setup lang="ts">
/**
 * Mis Cupones (Word 4.5).
 *
 * `GET /cupones` reevalúa las campañas al llamarlo, así que entrar aquí puede
 * hacer aparecer cupones nuevos. La API devuelve **solo los activos y no
 * vencidos**: el estado que se pinta se deriva de la vigencia.
 */
import { computed, onMounted, ref } from 'vue'
import { http } from '@/api/http'
import { useUiStore } from '@/stores/ui'
import { dinero, fecha, diasHasta } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'
import type { MiCupon } from '@/api/tipos'

const ui = useUiStore()

const cupones = ref<MiCupon[]>([])
const cargando = ref(true)

onMounted(async () => {
  try {
    cupones.value = await http.get<MiCupon[]>('/cupones')
  } catch (fallo) {
    ui.errorDeApi(fallo)
  } finally {
    cargando.value = false
  }
})

const hayCupones = computed(() => cupones.value.length > 0)

function descuento(cupon: MiCupon): string {
  return cupon.discountType === 'PERCENTAGE'
    ? `${cupon.discountValue}% de descuento`
    : `${dinero(cupon.discountValue)} de descuento`
}

/**
 * Estado del cupón.
 *
 * La API solo devuelve los vigentes, así que lo que le importa al cliente es
 * cuánto le queda para usarlo.
 */
function estado(cupon: MiCupon): { texto: string; urgente: boolean } {
  const dias = diasHasta(cupon.expiresAt)
  if (dias === null) return { texto: 'Vigente', urgente: false }
  if (dias <= 0) return { texto: 'Vence hoy', urgente: true }
  if (dias === 1) return { texto: 'Vence mañana', urgente: true }
  if (dias <= 7) return { texto: `Vence en ${dias} días`, urgente: true }
  return { texto: 'Vigente', urgente: false }
}

/**
 * Si merece la pena pintar la descripción.
 *
 * El título de la tarjeta ya sale de `customerMessage` o `title`; repetir ahí
 * abajo el mismo texto solo hace ruido.
 */
function descripcionVisible(cupon: MiCupon): boolean {
  const desc = cupon.description?.trim()
  if (!desc) return false
  const arriba = (cupon.customerMessage ?? cupon.title).trim()
  return desc !== arriba
}

async function copiar(codigo: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(codigo)
    ui.exito('Código copiado')
  } catch {
    ui.error('No pudimos copiar el código. Cópialo a mano.')
  }
}
</script>

<template>
  <div class="cupones">
    <SkeletonList v-if="cargando" :cantidad="3" />

    <template v-else-if="hayCupones">
      <article v-for="cupon in cupones" :key="cupon.id" class="coupon-card-full">
        <div class="coupon-top-row">
          <div class="coupon-code-block">
            <span class="coupon-code-badge">{{ cupon.code }}</span>
            <span class="estado" :class="{ urgente: estado(cupon).urgente }">
              {{ estado(cupon).texto }}
            </span>
          </div>
          <button type="button" class="btn-secondary" @click="copiar(cupon.code)">Copiar</button>
        </div>

        <p class="coupon-monto">{{ descuento(cupon) }}</p>
        <p class="coupon-titulo">{{ cupon.customerMessage ?? cupon.title }}</p>
        <!--
          La descripción es el texto largo que escribió el administrador. Se
          omite cuando repite lo que ya dice la línea de arriba.
        -->
        <p v-if="descripcionVisible(cupon)" class="coupon-desc">{{ cupon.description }}</p>

        <dl class="coupon-detail-grid">
          <div>
            <dt>Compra mínima</dt>
            <dd>
              {{ cupon.minimumOrderAmount > 0 ? dinero(cupon.minimumOrderAmount) : 'Sin mínimo' }}
            </dd>
          </div>
          <div v-if="cupon.maximumOrderAmount !== null">
            <dt>Compra máxima</dt>
            <dd>{{ dinero(cupon.maximumOrderAmount) }}</dd>
          </div>
          <div>
            <dt>Vigencia</dt>
            <dd>Hasta el {{ fecha(cupon.expiresAt) }}</dd>
          </div>
        </dl>

        <RouterLink to="/tienda" class="btn-primary ancho">Usarlo en un pedido</RouterLink>
      </article>
    </template>

    <p v-else class="empty-block">
      Todavía no tienes cupones. Haz un pedido y empieza a acumular beneficios.
    </p>
  </div>
</template>

<style scoped>
.cupones {
  padding: 12px 18px 0;
}

.coupon-card-full {
  background: var(--white);
  border-radius: 16px;
  padding: 14px;
  margin-bottom: 14px;
  box-shadow: var(--shadow);
  border-left: 4px solid var(--sage);
}

.coupon-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.coupon-code-block {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.coupon-code-badge {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  color: var(--terracotta-dark);
  background: var(--cream-2);
  padding: 4px 10px;
  border-radius: 8px;
  letter-spacing: 0.03em;
}

.estado {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 9.5px;
  color: var(--sage);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.estado.urgente {
  color: var(--terracotta);
}

.coupon-monto {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 20px;
  color: var(--terracotta-dark);
  margin: 0 0 4px;
}

.coupon-titulo {
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.4;
  margin: 0 0 12px;
}

.coupon-desc {
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.45;
  margin: -6px 0 12px;
}

.coupon-detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  margin: 0 0 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

.coupon-detail-grid div {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.coupon-detail-grid dt {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 9.5px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.coupon-detail-grid dd {
  font-size: 12px;
  color: var(--ink);
  font-weight: 600;
  margin: 0;
}

.ancho {
  width: 100%;
  display: block;
  text-decoration: none;
}
</style>
