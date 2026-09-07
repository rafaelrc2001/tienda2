/**
 * Evaluador de segmentos personalizados (Word 4.9.3).
 *
 * Funciones puras, sin Prisma ni Nest: son la regla de negocio mas delicada
 * del motor de cupones y conviene poder probarlas aisladas.
 */

export const ATRIBUTOS_SEGMENTO = [
  'pedidos',
  'totalGastado',
  'diasSinComprar',
  'diasComoCliente',
  'ciudad',
  'estado',
  'mesCumpleanos',
] as const;
export type AtributoSegmento = (typeof ATRIBUTOS_SEGMENTO)[number];

export const OPERADORES_SEGMENTO = ['>', '>=', '<', '<=', '=', 'contiene'] as const;
export type OperadorSegmento = (typeof OPERADORES_SEGMENTO)[number];

/** `contiene` solo tiene sentido sobre los atributos de texto. */
export const ATRIBUTOS_TEXTO: readonly AtributoSegmento[] = ['ciudad', 'estado'];

export interface ReglaSegmento {
  attr: AtributoSegmento;
  op: OperadorSegmento;
  value: string;
}

/** Lo que el evaluador necesita saber de un cliente. */
export interface ClienteSegmentable {
  pedidos: number;
  totalGastado: number;
  ultimoPedido: Date | null;
  creado: Date;
  ciudad: string | null;
  estado: string | null;
  fechaNacimiento: Date | null;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Un cliente que nunca ha comprado tiene "infinitos" dias sin comprar.
 * El prototipo usa 99999 para que una regla como "diasSinComprar > 30" lo
 * incluya en vez de descartarlo por falta de dato.
 */
const DIAS_SIN_COMPRAR_NUNCA = 99999;

export function evaluarRegla(
  cliente: ClienteSegmentable,
  regla: ReglaSegmento,
  ahora = new Date(),
): boolean {
  const esTexto = ATRIBUTOS_TEXTO.includes(regla.attr);
  let valor: number | string | null;

  switch (regla.attr) {
    case 'pedidos':
      valor = cliente.pedidos ?? 0;
      break;
    case 'totalGastado':
      valor = cliente.totalGastado ?? 0;
      break;
    case 'diasSinComprar':
      valor = cliente.ultimoPedido
        ? (ahora.getTime() - cliente.ultimoPedido.getTime()) / DIA_MS
        : DIAS_SIN_COMPRAR_NUNCA;
      break;
    case 'diasComoCliente':
      valor = cliente.creado ? (ahora.getTime() - cliente.creado.getTime()) / DIA_MS : 0;
      break;
    case 'ciudad':
      valor = (cliente.ciudad ?? '').toLowerCase();
      break;
    case 'estado':
      valor = (cliente.estado ?? '').toLowerCase();
      break;
    case 'mesCumpleanos':
      valor = cliente.fechaNacimiento ? cliente.fechaNacimiento.getMonth() + 1 : null;
      break;
    default:
      return false;
  }

  // Sin dato no se puede afirmar que cumpla: la regla falla.
  if (valor === null || valor === undefined) return false;

  if (esTexto) {
    const objetivo = regla.value.trim().toLowerCase();
    const texto = valor as string;
    switch (regla.op) {
      case '=':
        return texto === objetivo;
      case 'contiene':
        return objetivo !== '' && texto.includes(objetivo);
      default:
        // >, >=, < y <= no tienen sentido sobre ciudad o estado.
        return false;
    }
  }

  const objetivo = Number.parseFloat(regla.value);
  if (!Number.isFinite(objetivo)) return false;
  const numero = valor as number;

  switch (regla.op) {
    case '>':
      return numero > objetivo;
    case '>=':
      return numero >= objetivo;
    case '<':
      return numero < objetivo;
    case '<=':
      return numero <= objetivo;
    case '=':
      return numero === objetivo;
    case 'contiene':
      return false;
    default:
      return false;
  }
}

/**
 * Las reglas se combinan siempre con "Y" (Word 4.9.3).
 *
 * Un segmento sin reglas NO califica a nadie: es la regla 8 del Word 5, para
 * que una campana a medio configurar no acabe emitiendose a todo el mundo.
 */
export function clienteCumpleSegmento(
  cliente: ClienteSegmentable,
  reglas: ReglaSegmento[] | null | undefined,
  ahora = new Date(),
): boolean {
  if (!reglas || reglas.length === 0) return false;
  return reglas.every((regla) => evaluarRegla(cliente, regla, ahora));
}

/** Valida la forma de las reglas que llegan del panel antes de guardarlas. */
export function validarReglas(reglas: unknown): reglas is ReglaSegmento[] {
  if (!Array.isArray(reglas)) return false;
  return reglas.every((r: unknown) => {
    if (typeof r !== 'object' || r === null) return false;
    const regla = r as Partial<ReglaSegmento>;
    return (
      typeof regla.attr === 'string' &&
      ATRIBUTOS_SEGMENTO.includes(regla.attr as AtributoSegmento) &&
      typeof regla.op === 'string' &&
      OPERADORES_SEGMENTO.includes(regla.op as OperadorSegmento) &&
      typeof regla.value === 'string' &&
      regla.value.trim() !== ''
    );
  });
}
