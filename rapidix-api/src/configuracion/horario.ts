/**
 * Horario semanal: que dias abre y de que hora a que hora, dia por dia.
 *
 * Lo usan las tiendas (cada una con el suyo: el sabado puede cerrar antes y
 * no todas abren el domingo) y el envio a domicilio, que sale del horario
 * general de Configuracion. El horario ya no bloquea ningun pedido: solo
 * decide si se le avisa al cliente que su pedido queda para la siguiente
 * apertura.
 */

export const CLAVES_DIA = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'] as const;
export type ClaveDia = (typeof CLAVES_DIA)[number];

/** Horas de un dia, `HH:MM`. Si cierra antes de abrir, cruza la medianoche. */
export interface HorasDelDia {
  abre: string;
  cierra: string;
}

/** `null` (o ausente) es que ese dia no abre. */
export type HorarioSemanal = Partial<Record<ClaveDia, HorasDelDia | null>>;

/** Zona del negocio si no hay `ZONA_HORARIA`. Mexico no tiene horario de verano desde 2022. */
export const ZONA_HORARIA_NEGOCIO = 'America/Mexico_City';

const zonaPorDefecto = (): string => process.env.ZONA_HORARIA || ZONA_HORARIA_NEGOCIO;

const aMinutos = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Dia de la semana (0 = domingo) y minutos del dia de `momento` en `zona`.
 *
 * Se lee en la zona del negocio, no en la del servidor: Railway corre en UTC
 * y con `getHours()` a las 16:00 de Mexico ya eran las 22:00.
 */
export function relojLocal(momento: Date, zona: string): { dia: number; minutos: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(momento);
  const valor = (tipo: Intl.DateTimeFormatPartTypes): string =>
    partes.find((p) => p.type === tipo)?.value ?? '';
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(valor('weekday'));
  return { dia, minutos: Number(valor('hour')) * 60 + Number(valor('minute')) };
}

/**
 * Lee lo guardado en una columna JSON descartando lo que no cuadre: un dia
 * con horas mal escritas cuenta como cerrado en vez de romper el carrito.
 */
export function leerHorario(valor: unknown): HorarioSemanal | null {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return null;
  const hora = /^([01]\d|2[0-3]):[0-5]\d$/;
  const crudo = valor as Record<string, unknown>;
  const horario: HorarioSemanal = {};
  for (const clave of CLAVES_DIA) {
    const dia = crudo[clave] as Partial<HorasDelDia> | null | undefined;
    horario[clave] =
      dia && typeof dia.abre === 'string' && typeof dia.cierra === 'string'
        ? hora.test(dia.abre) && hora.test(dia.cierra)
          ? { abre: dia.abre, cierra: dia.cierra }
          : null
        : null;
  }
  return horario;
}

/** Si en `momento` esta abierto. Un dia que cruza la medianoche sigue abierto de madrugada. */
export function estaAbierto(
  horario: HorarioSemanal,
  momento = new Date(),
  zona = zonaPorDefecto(),
): boolean {
  const { dia, minutos } = relojLocal(momento, zona);

  const hoy = horario[CLAVES_DIA[dia]];
  if (hoy) {
    const abre = aMinutos(hoy.abre);
    const cierra = aMinutos(hoy.cierra);
    if (abre <= cierra ? minutos >= abre && minutos < cierra : minutos >= abre) return true;
  }

  // La madrugada es la cola del dia anterior si ese cruzaba la medianoche.
  const ayer = horario[CLAVES_DIA[(dia + 6) % 7]];
  return !!ayer && aMinutos(ayer.abre) > aMinutos(ayer.cierra) && minutos < aMinutos(ayer.cierra);
}

/**
 * El aviso del carrito fuera de horario. El pedido se acepta igual: solo se
 * le dice al cliente que se atiende el dia siguiente habil. El texto es fijo a
 * peticion del negocio; el horario completo lo ve el cliente en "Ver horarios".
 */
export function avisoFueraDeHorario(
  horario: HorarioSemanal,
  donde: string,
  momento = new Date(),
  zona = zonaPorDefecto(),
): string | null {
  if (estaAbierto(horario, momento, zona)) return null;
  return `${donde} está fuera de horario: tu pedido quedará programado para el día siguiente hábil.`;
}
