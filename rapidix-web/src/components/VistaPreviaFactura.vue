<script setup lang="ts">
/**
 * El CFDI tal como lo armó la API, antes de timbrar: emisor, receptor, pago,
 * conceptos y totales. Lo comparten «Facturar» de Mis pedidos (y Finanzas) y
 * el del punto de venta; los botones los pone cada hoja en el slot.
 *
 * Los nombres de las claves salen de los catálogos que ya trajo la hoja: aquí
 * no hay copia de los catálogos del SAT.
 */
import { computed } from 'vue'
import { dinero } from '@/utils/formato'
import type { DatosFiscalesRespuesta, VistaFactura } from '@/api/tipos'

const props = defineProps<{
  vista: VistaFactura
  catalogos: Pick<DatosFiscalesRespuesta, 'regimenes' | 'usos' | 'formasPago'> | null
  /** Quién es el receptor en la nota de la retención: «tú eres» o «el cliente es». */
  receptorEnTercera?: boolean
}>()

function nombreRegimen(clave: string | null): string {
  if (!clave) return 'Sin capturar'
  const r = props.catalogos?.regimenes.find((x) => x.clave === clave)
  return r ? `${clave} · ${r.nombre}` : clave
}

function nombreUso(clave: string): string {
  const u = props.catalogos?.usos.find((x) => x.clave === clave)
  return u ? `${clave} · ${u.nombre}` : clave
}

function nombreForma(clave: string): string {
  const f = props.catalogos?.formasPago.find((x) => x.clave === clave)
  return f ? `${clave} · ${f.descripcion}` : clave
}

const conRetencion = computed(() => props.vista.retencionIsr > 0)
</script>

<template>
  <section aria-label="Vista previa de la factura">
    <p v-if="vista.modo === 'SIMULADO'" class="aviso-demo">
      Modo demostración: la factura se genera con un folio de prueba y no tiene validez fiscal.
    </p>
    <p class="modal-texto">Revisa la factura antes de timbrarla: así se manda al SAT.</p>

    <div class="partes">
      <div class="parte">
        <p class="seccion">Emisor</p>
        <dl>
          <div>
            <dt>RFC</dt>
            <dd>{{ vista.emisor.rfc ?? 'Sin capturar' }}</dd>
          </div>
          <div>
            <dt>Nombre</dt>
            <dd>{{ vista.emisor.nombre ?? 'Sin capturar' }}</dd>
          </div>
          <div>
            <dt>Régimen</dt>
            <dd>{{ nombreRegimen(vista.emisor.regimen) }}</dd>
          </div>
        </dl>
      </div>
      <div class="parte">
        <p class="seccion">Receptor</p>
        <dl>
          <div>
            <dt>RFC</dt>
            <dd>{{ vista.receptor.rfc }}</dd>
          </div>
          <div>
            <dt>Razón social</dt>
            <dd>{{ vista.receptor.razonSocial }}</dd>
          </div>
          <div>
            <dt>Régimen</dt>
            <dd>{{ nombreRegimen(vista.receptor.regimenFiscal) }}</dd>
          </div>
          <div>
            <dt>Uso del CFDI</dt>
            <dd>{{ nombreUso(vista.receptor.usoCfdi) }}</dd>
          </div>
          <div>
            <dt>Código postal</dt>
            <dd>{{ vista.receptor.cpFiscal }}</dd>
          </div>
        </dl>
      </div>
      <div class="parte">
        <p class="seccion">Pago</p>
        <dl>
          <div>
            <dt>Forma de pago</dt>
            <dd>{{ nombreForma(vista.formaPago) }}</dd>
          </div>
          <div>
            <dt>Método de pago</dt>
            <dd>PUE · Pago en una sola exhibición</dd>
          </div>
        </dl>
      </div>
    </div>

    <div class="tabla-envoltorio">
      <table class="tabla lineal conceptos">
        <thead>
          <tr>
            <th class="num">Cant.</th>
            <th>Concepto</th>
            <th class="num">P. unitario</th>
            <th class="num">Importe</th>
            <th class="num">Desc.</th>
            <th class="num">IVA</th>
            <th v-if="conRetencion" class="num">ISR ret.</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(c, i) in vista.conceptos" :key="i">
            <td class="num">{{ c.cantidad }}</td>
            <td>
              {{ c.descripcion }}
              <span class="claves">{{ c.claveProdServ }} · {{ c.claveUnidad }} {{ c.unidad }}</span>
            </td>
            <td class="num">{{ dinero(Number(c.valorUnitario)) }}</td>
            <td class="num">{{ dinero(c.importe) }}</td>
            <td class="num">{{ c.descuento > 0 ? dinero(c.descuento) : '—' }}</td>
            <td class="num">{{ c.tasaIva === 'DIECISEIS' ? '16%' : '0%' }} {{ dinero(c.iva) }}</td>
            <td v-if="conRetencion" class="num">{{ dinero(c.retencionIsr) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <dl class="totales">
      <div>
        <dt>Subtotal</dt>
        <dd>{{ dinero(vista.subtotal) }}</dd>
      </div>
      <div v-if="vista.descuento > 0">
        <dt>Descuento</dt>
        <dd>−{{ dinero(vista.descuento) }}</dd>
      </div>
      <div>
        <dt>IVA trasladado</dt>
        <dd>{{ dinero(vista.iva) }}</dd>
      </div>
      <div v-if="conRetencion">
        <dt>ISR retenido 1.25 %</dt>
        <dd>−{{ dinero(vista.retencionIsr) }}</dd>
      </div>
      <div class="fuerte">
        <dt>Total</dt>
        <dd>{{ dinero(vista.total) }}</dd>
      </div>
    </dl>
    <p v-if="conRetencion" class="nota-retencion">
      Lleva retención de ISR: la razón social que emite está en RESICO (626) y
      {{ receptorEnTercera ? 'el cliente es' : 'tú eres' }} persona moral. El total sigue siendo
      lo cobrado: subtotal + IVA − retención.
    </p>

    <div class="modal-actions">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.modal-texto {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.45;
}

.aviso-demo {
  margin: 0 0 12px;
  padding: 9px 12px;
  border-radius: 11px;
  background: var(--cream-2);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11.5px;
  color: var(--terracotta-dark);
}

/* Emisor, receptor y pago como texto, para que no parezcan campos. */
.partes {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
}

.partes dl {
  margin: 0;
}

.parte {
  padding: 10px 12px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-md);
}

.partes dl div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
}

.partes dl div + div {
  margin-top: 3px;
}

.partes dt {
  color: var(--muted);
  white-space: nowrap;
}

.partes dd {
  margin: 0;
  font-weight: 700;
  color: var(--ink);
  text-align: right;
  overflow-wrap: anywhere;
}

.seccion {
  margin: 0 0 6px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--muted);
}

.conceptos {
  min-width: 560px;
}

.claves {
  display: block;
  font-size: 10.5px;
  color: var(--muted);
}

.totales {
  display: grid;
  gap: 4px;
  max-width: 280px;
  margin: 12px 0 0 auto;
}

.totales div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: var(--ink);
}

.totales dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.totales .fuerte {
  border-top: 1px solid var(--line);
  padding-top: 4px;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 16px;
}

.nota-retencion {
  margin: 10px 0 0;
  font-size: 11.5px;
  color: var(--terracotta-dark);
}
</style>
