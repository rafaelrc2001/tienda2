import type { DireccionEntrega, Perfil } from '@/api/tipos'

/**
 * Reglas de la dirección de entrega del checkout (épica «Dirección de entrega»).
 *
 * Funciones puras: la vista las usa para precargar, resumir y validar, y se
 * prueban sin montar nada.
 */

export type CampoDireccion = keyof Omit<DireccionEntrega, 'lat' | 'lng'>

export function direccionVacia(): DireccionEntrega {
  return {
    quienRecibe: '',
    telefono: '',
    calle: '',
    colonia: '',
    cp: '',
    ciudad: '',
    estado: '',
    referencias: '',
    lat: null,
    lng: null,
  }
}

/** Solo dígitos, con tope. Para CP y teléfono, que se pegan con espacios o guiones. */
export function soloDigitos(texto: string, maximo: number): string {
  return texto.replace(/\D/g, '').slice(0, maximo)
}

/**
 * El teléfono del login puede venir con lada (`+52 1 993…`): quien recibe se
 * precarga con los últimos 10 dígitos, que es lo que pide el formulario.
 */
function telefonoLocal(telefono: string | null | undefined): string {
  const digitos = (telefono ?? '').replace(/\D/g, '')
  return digitos.length >= 10 ? digitos.slice(-10) : digitos
}

/**
 * La dirección con la que abre el checkout (HU-02), en orden de prioridad:
 * lo que ya capturó para este pedido, la de su perfil, o vacía. Si el perfil
 * no dice quién recibe, recibe el propio usuario.
 */
export function direccionInicial(
  borrador: DireccionEntrega | null,
  perfil: Perfil | null,
): DireccionEntrega {
  if (borrador) return { ...direccionVacia(), ...borrador }
  if (!perfil) return direccionVacia()
  const d = perfil.direccion
  return {
    quienRecibe: perfil.quienRecibe?.trim() || perfil.nombre || '',
    telefono: telefonoLocal(perfil.telefono),
    calle: d.calle ?? '',
    colonia: d.colonia ?? '',
    cp: d.cp ?? '',
    ciudad: d.ciudad ?? '',
    estado: d.estado ?? '',
    referencias: d.referencias ?? '',
    lat: d.lat,
    lng: d.lng,
  }
}

/** El perfil tiene dirección si tiene calle: decide el texto del botón (HU-05). */
export function perfilTieneDireccion(perfil: Perfil | null): boolean {
  return !!perfil?.direccion.calle?.trim()
}

/** Con calle y ciudad ya se sabe a dónde va: el bloque puede empezar cerrado (HU-06). */
export function direccionCompleta(d: DireccionEntrega): boolean {
  return !!d.calle.trim() && !!d.ciudad.trim()
}

/** «Quién recibe · Calle · Ciudad», o vacío si no hay nada que resumir. */
export function resumenDireccion(d: DireccionEntrega): string {
  return [d.quienRecibe, d.calle, d.ciudad]
    .map((parte) => parte.trim())
    .filter(Boolean)
    .join(' · ')
}

/**
 * Lo que falta para poder pagar a domicilio (HU-10), campo por campo, en el
 * orden del formulario. Es la misma regla que aplica `CrearPedidoDto` en la
 * API; aquí sirve para apagar el botón y marcar en rojo, no para decidir.
 */
export function erroresDireccion(d: DireccionEntrega): Partial<Record<CampoDireccion, string>> {
  const errores: Partial<Record<CampoDireccion, string>> = {}
  if (!d.quienRecibe.trim()) errores.quienRecibe = 'Escribe quién recibe'
  if (!/^\d{10}$/.test(d.telefono)) errores.telefono = 'El teléfono debe tener 10 dígitos'
  if (!d.calle.trim()) errores.calle = 'Escribe la calle y el número'
  if (!d.colonia.trim()) errores.colonia = 'Escribe la colonia'
  if (!/^\d{5}$/.test(d.cp)) errores.cp = 'El CP debe tener 5 dígitos'
  if (!d.ciudad.trim()) errores.ciudad = 'Escribe la ciudad'
  return errores
}

/** Nombres cortos para el aviso bajo el botón de confirmar. */
const NOMBRES: Record<CampoDireccion, string> = {
  quienRecibe: 'quién recibe',
  telefono: 'teléfono',
  calle: 'calle',
  colonia: 'colonia',
  cp: 'código postal',
  ciudad: 'ciudad',
  estado: 'estado',
  referencias: 'referencias',
}

export function faltantesDireccion(d: DireccionEntrega): string[] {
  return (Object.keys(erroresDireccion(d)) as CampoDireccion[]).map((c) => NOMBRES[c])
}
