/**
 * Punto de enchufe para WhatsApp Business API / n8n.
 *
 * El SPEC 01 deja la integracion real fuera de alcance (Word 8), asi que el
 * backend habla siempre contra esta interfaz. Cambiar de proveedor es cambiar
 * la implementacion registrada en NotificationsModule, nada mas.
 */
export interface NotificationSender {
  /** Envia el codigo de un solo uso para iniciar sesion. */
  enviarCodigoOtp(telefono: string, codigo: string): Promise<void>;

  /** Avisa al cliente de que tiene un cupon nuevo. */
  enviarMensajeCupon(telefono: string, mensaje: string): Promise<void>;
}

export const NOTIFICATION_SENDER = Symbol('NOTIFICATION_SENDER');
