/**
 * Horario semanal de una tienda: los días en orden y su resumen en una línea.
 *
 * El horario es informativo: la API no bloquea pedidos por él, solo avisa
 * que el pedido queda para la siguiente apertura. Aquí solo se pinta.
 */
import type { ClaveDia, HorarioSemanal } from '@/api/tipos'

export const DIAS_SEMANA: { clave: ClaveDia; corto: string; largo: string }[] = [
  { clave: 'lun', corto: 'Lun', largo: 'Lunes' },
  { clave: 'mar', corto: 'Mar', largo: 'Martes' },
  { clave: 'mie', corto: 'Mié', largo: 'Miércoles' },
  { clave: 'jue', corto: 'Jue', largo: 'Jueves' },
  { clave: 'vie', corto: 'Vie', largo: 'Viernes' },
  { clave: 'sab', corto: 'Sáb', largo: 'Sábado' },
  { clave: 'dom', corto: 'Dom', largo: 'Domingo' },
]

/** El de una tienda nueva: de lunes a sábado de 9 a 18, domingo cerrado. */
export function horarioPorDefecto(): HorarioSemanal {
  const abierto = () => ({ abre: '09:00', cierra: '18:00' })
  return {
    lun: abierto(),
    mar: abierto(),
    mie: abierto(),
    jue: abierto(),
    vie: abierto(),
    sab: abierto(),
    dom: null,
  }
}

/**
 * «Lun a Vie 09:00–18:00 · Sáb 09:00–14:00 · Dom cerrado». Junta los días
 * seguidos con las mismas horas para que quepa en una línea.
 */
export function resumenHorario(horario: HorarioSemanal): string {
  const texto = (clave: ClaveDia): string => {
    const horas = horario[clave]
    return horas ? `${horas.abre}–${horas.cierra}` : 'cerrado'
  }

  const tramos: { desde: string; hasta: string; horas: string }[] = []
  for (const dia of DIAS_SEMANA) {
    const horas = texto(dia.clave)
    const ultimo = tramos.at(-1)
    if (ultimo && ultimo.horas === horas) ultimo.hasta = dia.corto
    else tramos.push({ desde: dia.corto, hasta: dia.corto, horas })
  }

  return tramos
    .map((t) => `${t.desde === t.hasta ? t.desde : `${t.desde} a ${t.hasta}`} ${t.horas}`)
    .join(' · ')
}
