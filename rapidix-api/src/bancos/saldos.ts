import { Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;

/**
 * La aritmetica del estado de cuenta de Bancos. Funciones puras: el servicio
 * trae los periodos y las sumas de la base y aqui solo se encadenan.
 */

export interface Mes {
  anio: number;
  /** 1 a 12. */
  mes: number;
}

/** Un numero que crece con el tiempo: sirve para ordenar y comparar meses. */
export function claveMes({ anio, mes }: Mes): number {
  return anio * 12 + (mes - 1);
}

export function mesSiguiente({ anio, mes }: Mes): Mes {
  return mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 };
}

/** El mes de un dia `AAAA-MM-DD`. */
export function mesDelDia(dia: string): Mes {
  const [anio, mes] = dia.split('-').map(Number);
  return { anio, mes };
}

/** Que `dia` (`AAAA-MM-DD`) exista y caiga dentro de ese mes. */
export function diaDentroDelMes(dia: string, periodo: Mes): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  const [anio, mes, d] = dia.split('-').map(Number);
  // `Date.UTC` acomoda el 31 de febrero en marzo: si cambia, el dia no existe.
  const fecha = new Date(Date.UTC(anio, mes - 1, d));
  return anio === periodo.anio && mes === periodo.mes && fecha.getUTCMonth() + 1 === mes;
}

export interface PeriodoParaSaldo extends Mes {
  id: string;
  saldoApertura: Prisma.Decimal | null;
}

export interface Saldos {
  inicial: Prisma.Decimal;
  final: Prisma.Decimal;
}

/**
 * Encadena los saldos de los periodos de una cuenta: el inicial de cada uno es
 * su apertura si se escribio una y, si no, el final del anterior. Se calcula
 * en vivo para que un movimiento capturado tarde en un mes viejo arrastre a
 * los siguientes, hasta el proximo mes con apertura propia, que empieza de
 * nuevo en ella.
 *
 * `sumas` trae lo movido en cada periodo; el que no aparece no movio nada.
 * El orden de entrada no importa: se ordenan por mes.
 */
export function encadenarSaldos(
  periodos: PeriodoParaSaldo[],
  sumas: Map<string, Prisma.Decimal>,
): Map<string, Saldos> {
  const ordenados = [...periodos].sort((a, b) => claveMes(a) - claveMes(b));
  const saldos = new Map<string, Saldos>();
  let arrastre = new Decimal(0);
  ordenados.forEach((periodo) => {
    // El primero siempre trae apertura (lo exige `abrirPeriodo`); sin ella
    // empezaria en cero.
    const inicial = periodo.saldoApertura ?? arrastre;
    const final = inicial.add(sumas.get(periodo.id) ?? 0);
    saldos.set(periodo.id, { inicial, final });
    arrastre = final;
  });
  return saldos;
}
