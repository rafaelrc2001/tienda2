<script setup lang="ts">
/**
 * Los horarios de una tienda, día por día. Lo abre «Ver horarios» en el
 * carrito. Un día sin horas capturadas —o una tienda sin horario— se lee
 * «Cerrado».
 */
import { DIAS_SEMANA } from '@/utils/horario'
import type { HorarioSemanal } from '@/api/tipos'

defineProps<{ nombre: string; horario: HorarioSemanal | null }>()
const emit = defineEmits<{ (e: 'cerrar'): void }>()
</script>

<template>
  <div class="modal-overlay" @click.self="emit('cerrar')">
    <div class="modal-sheet" role="dialog" :aria-label="`Horarios de ${nombre}`">
      <div class="modal-handle" />
      <p class="modal-title">🕒 Horarios · {{ nombre }}</p>

      <table class="tabla-horario">
        <tbody>
          <tr v-for="dia in DIAS_SEMANA" :key="dia.clave">
            <th scope="row">{{ dia.largo }}</th>
            <td v-if="horario?.[dia.clave]">
              {{ horario[dia.clave]!.abre }} a {{ horario[dia.clave]!.cierra }}
            </td>
            <td v-else class="cerrado">Cerrado</td>
          </tr>
        </tbody>
      </table>

      <div class="modal-actions">
        <button type="button" class="btn-primary" @click="emit('cerrar')">Entendido</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tabla-horario {
  width: 100%;
  border-collapse: collapse;
  background: var(--white);
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 14px;
  font-size: 13.5px;
}

.tabla-horario th,
.tabla-horario td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  text-align: left;
}

.tabla-horario tr:last-child th,
.tabla-horario tr:last-child td {
  border-bottom: 0;
}

.tabla-horario th {
  font-family: var(--font-heading);
  font-weight: 700;
  color: var(--ink);
}

.tabla-horario td {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}

.tabla-horario td.cerrado {
  color: var(--muted);
}
</style>
