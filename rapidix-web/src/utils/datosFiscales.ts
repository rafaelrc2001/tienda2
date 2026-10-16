/**
 * Lo que comparten las dos pantallas que capturan datos fiscales («Facturar»
 * de Mis pedidos y la tarjeta del Perfil): la forma del formulario, cómo se
 * llena con lo guardado y cómo se manda a la API.
 */
import type { DatosFiscales, DatosFiscalesRespuesta } from '@/api/tipos'

export const CAMPOS_FISCALES = [
  'rfc',
  'razonSocial',
  'regimenFiscal',
  'usoCfdi',
  'cpFiscal',
  'email',
] as const
export type CampoFiscal = (typeof CAMPOS_FISCALES)[number]

export interface FormularioFiscal {
  rfc: string
  razonSocial: string
  regimenFiscal: string
  usoCfdi: string
  cpFiscal: string
  email: string
}

/** Lo guardado si lo hay; si no, vacío con el correo del perfil y uso G03. */
export function formularioFiscalDesde(respuesta: DatosFiscalesRespuesta): FormularioFiscal {
  const datos = respuesta.datos
  if (datos) return { ...datos, email: datos.email ?? '' }
  return {
    rfc: '',
    razonSocial: '',
    regimenFiscal: '',
    usoCfdi: 'G03',
    cpFiscal: '',
    email: respuesta.emailSugerido ?? '',
  }
}

/** El cuerpo de `PUT /perfil/datos-fiscales` y de `POST /pedidos/:id/factura`. */
export function cuerpoFiscal(f: FormularioFiscal): DatosFiscales & { email: string } {
  return {
    rfc: f.rfc.trim().toUpperCase(),
    razonSocial: f.razonSocial.trim(),
    regimenFiscal: f.regimenFiscal,
    usoCfdi: f.usoCfdi,
    cpFiscal: f.cpFiscal.trim(),
    email: f.email.trim(),
  }
}

/** «rfc no es válido…» llega con el nombre del campo delante; bajo el campo sobra. */
export function erroresSinNombreDeCampo(
  campos: Record<string, string>,
): Partial<Record<CampoFiscal, string>> {
  return Object.fromEntries(
    Object.entries(campos).map(([campo, mensaje]) => {
      const resto = mensaje.slice(campo.length + 1)
      return [campo, resto.charAt(0).toUpperCase() + resto.slice(1)]
    }),
  )
}
