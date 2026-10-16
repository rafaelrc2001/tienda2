/**
 * Lo que el cliente elige en el formulario de factura: los regimenes fiscales
 * y los usos del CFDI que aplican a una compra de abarrotes.
 *
 * Viajan al frontend en `GET /perfil/datos-fiscales`: la interfaz no lleva su
 * propia copia, igual que no la lleva de los permisos. Ampliar un catalogo es
 * tocar solo aqui.
 */

export type TipoPersona = 'FISICA' | 'MORAL';

export interface RegimenFiscal {
  clave: string;
  nombre: string;
  /** Para quien aplica: el RFC de 12 caracteres es moral; el de 13, fisica. */
  personas: TipoPersona[];
}

export interface UsoCfdi {
  clave: string;
  nombre: string;
}

export const REGIMENES_FISCALES: RegimenFiscal[] = [
  { clave: '601', nombre: 'General de Ley Personas Morales', personas: ['MORAL'] },
  { clave: '603', nombre: 'Personas Morales con Fines no Lucrativos', personas: ['MORAL'] },
  {
    clave: '605',
    nombre: 'Sueldos y Salarios e Ingresos Asimilados a Salarios',
    personas: ['FISICA'],
  },
  { clave: '606', nombre: 'Arrendamiento', personas: ['FISICA'] },
  {
    clave: '612',
    nombre: 'Personas Físicas con Actividades Empresariales y Profesionales',
    personas: ['FISICA'],
  },
  { clave: '616', nombre: 'Sin obligaciones fiscales', personas: ['FISICA'] },
  { clave: '621', nombre: 'Incorporación Fiscal', personas: ['FISICA'] },
  { clave: '626', nombre: 'Régimen Simplificado de Confianza', personas: ['FISICA', 'MORAL'] },
];

/**
 * P01 («Por definir») ya no existe en CFDI 4.0. S01 es el de quien pide la
 * factura sin deducirla, y el unico que acepta el regimen 616.
 */
export const USOS_CFDI: UsoCfdi[] = [
  { clave: 'G01', nombre: 'Adquisición de mercancías' },
  { clave: 'G03', nombre: 'Gastos en general' },
  { clave: 'S01', nombre: 'Sin efectos fiscales' },
];

export function tipoPersona(rfc: string): TipoPersona {
  return rfc.trim().length === 12 ? 'MORAL' : 'FISICA';
}

/**
 * Las combinaciones que el SAT rechaza seguro, dichas antes de llamar al
 * proveedor y en palabras del cliente. Lo demas (que el RFC exista, que el
 * nombre y el CP coincidan con su constancia) solo lo sabe el SAT.
 */
export function incompatibilidad(datos: {
  rfc: string;
  regimenFiscal: string;
  usoCfdi: string;
}): string | null {
  const regimen = REGIMENES_FISCALES.find((r) => r.clave === datos.regimenFiscal);
  const persona = tipoPersona(datos.rfc);
  if (regimen && !regimen.personas.includes(persona)) {
    return persona === 'MORAL'
      ? 'Ese régimen es de personas físicas y tu RFC es de persona moral.'
      : 'Ese régimen es de personas morales y tu RFC es de persona física.';
  }
  if (datos.regimenFiscal === '616' && datos.usoCfdi !== 'S01') {
    return 'Con el régimen «Sin obligaciones fiscales» el uso del CFDI tiene que ser «Sin efectos fiscales».';
  }
  return null;
}
