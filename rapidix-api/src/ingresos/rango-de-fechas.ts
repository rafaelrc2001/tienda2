import { BadRequestException } from '@nestjs/common';

/**
 * El rango de dias que pide la pestana de Ingresos, vuelto instantes.
 *
 * Funciones puras. "Los ingresos de hoy" son los del dia del negocio, no los
 * del servidor: Railway corre en UTC, y un ingreso aceptado a las 19:00 de
 * Mexico ya es de manana alla. Por eso los dias se leen y se cortan en la zona
 * del negocio, igual que el horario de servicio.
 */

/** La misma zona por defecto que el horario del negocio. */
const ZONA_HORARIA_NEGOCIO = 'America/Mexico_City';

export function zonaDelNegocio(): string {
  return process.env.ZONA_HORARIA || ZONA_HORARIA_NEGOCIO;
}

export interface RangoDeFechas {
  /** Primer dia, `AAAA-MM-DD`, tal como se pinta en el filtro. */
  desde: string;
  /** Ultimo dia, incluido. */
  hasta: string;
  /** El primer instante de `desde`. */
  inicio: Date;
  /** El primer instante del dia siguiente a `hasta`: el rango no lo incluye. */
  fin: Date;
}

/** El dia que es en `zona` en ese momento, como `AAAA-MM-DD`. */
export function diaEn(momento: Date, zona: string): string {
  // en-CA escribe la fecha como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(momento);
}

/** Cuanto va adelantada `zona` respecto a UTC en ese momento, en milisegundos. */
function desfase(momento: Date, zona: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(momento);
  const valor = (tipo: Intl.DateTimeFormatPartTypes): number =>
    Number(partes.find((p) => p.type === tipo)?.value);
  const local = Date.UTC(
    valor('year'),
    valor('month') - 1,
    valor('day'),
    valor('hour'),
    valor('minute'),
    valor('second'),
  );
  return local - Math.floor(momento.getTime() / 1000) * 1000;
}

/**
 * El instante en que empieza ese dia en `zona`.
 *
 * Se corrige dos veces: el desfase se mide primero en la medianoche UTC, que
 * puede caer del otro lado de un cambio de horario respecto a la medianoche
 * local.
 */
export function inicioDelDia(dia: string, zona: string): Date {
  const [anio, mes, d] = dia.split('-').map(Number);
  const medianocheUtc = Date.UTC(anio, mes - 1, d);
  let instante = medianocheUtc - desfase(new Date(medianocheUtc), zona);
  instante = medianocheUtc - desfase(new Date(instante), zona);
  return new Date(instante);
}

/** El dia siguiente, como `AAAA-MM-DD`. Aritmetica de calendario, sin zonas. */
export function diaSiguiente(dia: string): string {
  const [anio, mes, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, d + 1)).toISOString().slice(0, 10);
}

/** Que el texto sea un dia que existe: `2026-02-30` tiene la forma y no existe. */
function esDia(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [anio, mes, d] = texto.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, d));
  return fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === d;
}

/**
 * El rango a consultar. Sin fechas es hoy; con una sola, ese dia; con las dos,
 * de la primera a la segunda, las dos incluidas.
 */
export function rangoDeFechas(
  desde: string | undefined,
  hasta: string | undefined,
  ahora = new Date(),
  zona = zonaDelNegocio(),
): RangoDeFechas {
  const hoy = diaEn(ahora, zona);
  const primero = desde ?? hasta ?? hoy;
  const ultimo = hasta ?? desde ?? hoy;

  if (!esDia(primero) || !esDia(ultimo)) {
    throw new BadRequestException('Las fechas van como AAAA-MM-DD');
  }
  if (primero > ultimo) {
    throw new BadRequestException('La fecha inicial no puede ser posterior a la final');
  }

  return {
    desde: primero,
    hasta: ultimo,
    inicio: inicioDelDia(primero, zona),
    fin: inicioDelDia(diaSiguiente(ultimo), zona),
  };
}
