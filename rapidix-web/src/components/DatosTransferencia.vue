<script setup lang="ts">
/**
 * Los datos para transferir a una de las cuentas del negocio, con un «Copiar»
 * en todo lo que hay que teclear en la app del banco.
 *
 * Lo usa el carrito dos veces: al elegir transferencia, con la cuenta que
 * toca según «Requiero factura» (principal con factura, secundaria sin ella),
 * y en la pantalla de éxito, donde se suman el monto y la referencia.
 *
 * Salen la tarjeta (depósito en OXXO y similares) y la CLABE (SPEI): son las
 * dos maneras de pagar. El número de cuenta no se muestra; basta con esas dos.
 */
import { dinero } from '@/utils/formato'
import { useUiStore } from '@/stores/ui'
import type { Bancarios } from '@/api/tipos'

defineProps<{
  cuenta: Bancarios
  /** Lo que hay que transferir; solo en la pantalla de éxito, ya con el pedido hecho. */
  monto?: number | null
  /** El folio, que va como concepto. Solo existe con el pedido hecho. */
  referencia?: string | null
}>()

const ui = useUiStore()

/**
 * Copia un dato bancario. Sin permiso de portapapeles, el dato sigue
 * seleccionable. El aviso llega ya conjugado: «CLABE copiada» pero
 * «Beneficiario copiado».
 */
async function copiar(texto: string, aviso: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(texto)
    ui.exito(aviso)
  } catch {
    ui.error('No pudimos copiar. Mantén presionado el número para copiarlo.')
  }
}
</script>

<template>
  <dl class="datos-banco">
    <div>
      <dt>Banco</dt>
      <dd>{{ cuenta.banco ?? '—' }}</dd>
    </div>
    <div v-if="cuenta.beneficiario">
      <dt>Beneficiario</dt>
      <dd class="dato-copiable">
        <span class="dato-fuerte">{{ cuenta.beneficiario }}</span>
        <button
          type="button"
          class="boton-copiar"
          aria-label="Copiar beneficiario"
          @click="copiar(cuenta.beneficiario, 'Beneficiario copiado')"
        >
          Copiar
        </button>
      </dd>
    </div>
    <div v-if="cuenta.numeroTarjeta">
      <dt>Tarjeta</dt>
      <dd class="dato-copiable">
        <span class="dato-fuerte">{{ cuenta.numeroTarjeta }}</span>
        <button
          type="button"
          class="boton-copiar"
          aria-label="Copiar número de tarjeta"
          @click="copiar(cuenta.numeroTarjeta, 'Tarjeta copiada')"
        >
          Copiar
        </button>
      </dd>
    </div>
    <div v-if="cuenta.clabe">
      <dt>CLABE</dt>
      <dd class="dato-copiable">
        <span class="dato-fuerte">{{ cuenta.clabe }}</span>
        <button
          type="button"
          class="boton-copiar"
          aria-label="Copiar CLABE"
          @click="copiar(cuenta.clabe, 'CLABE copiada')"
        >
          Copiar
        </button>
      </dd>
    </div>
    <div v-if="monto != null">
      <dt>Monto</dt>
      <dd class="dato-copiable">
        <span class="dato-fuerte">{{ dinero(monto) }}</span>
        <!-- Se copia el número pelado: el «$» no se teclea en el banco. -->
        <button
          type="button"
          class="boton-copiar"
          aria-label="Copiar monto"
          @click="copiar(monto.toFixed(2), 'Monto copiado')"
        >
          Copiar
        </button>
      </dd>
    </div>
    <div v-if="referencia">
      <dt>Referencia</dt>
      <dd class="dato-copiable">
        <span class="dato-fuerte">{{ referencia }}</span>
        <button
          type="button"
          class="boton-copiar"
          aria-label="Copiar referencia"
          @click="copiar(referencia, 'Referencia copiada')"
        >
          Copiar
        </button>
      </dd>
    </div>
  </dl>
</template>

<style scoped>
.datos-banco {
  margin: 10px 0 0;
}

.datos-banco div {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--divisor, var(--line));
  font-size: 12px;
}

.datos-banco > div:last-child {
  border-bottom: none;
}

.datos-banco dt {
  color: var(--muted);
}

/* `anywhere` y no `break-all`: parte el número largo sin trocear los nombres. */
.datos-banco dd {
  margin: 0;
  color: var(--ink);
  text-align: right;
  overflow-wrap: anywhere;
}

.datos-banco .dato-fuerte {
  font-family: var(--font-heading);
  font-weight: 800;
  user-select: all;
}

.dato-copiable {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.boton-copiar {
  flex-shrink: 0;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 11px;
  color: var(--verde-dark);
  background: var(--white);
  border: 1.5px solid var(--verde-dark);
  border-radius: 999px;
  padding: 3px 10px;
  cursor: pointer;
}
</style>
