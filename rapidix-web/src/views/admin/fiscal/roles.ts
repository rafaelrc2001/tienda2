/**
 * Cómo se dice el rol de quien creó una factura en las tablas de facturas
 * (Fiscal → Facturación y PDV → Facturación). La API manda el `RolToken` tal
 * cual: el cliente desde la app o alguien del personal.
 */
const NOMBRES: Record<string, string> = {
  CLIENTE: 'Cliente, desde la app',
  ADMINISTRADOR: 'Administrador',
  RUTA: 'Ruta',
  OPERACIONES: 'Operaciones',
  FINANZAS: 'Finanzas',
  PDV: 'Punto de venta',
}

export function nombreRol(rol: string | null): string {
  if (!rol) return ''
  return NOMBRES[rol] ?? rol
}
