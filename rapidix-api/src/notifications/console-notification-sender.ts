import { Injectable, Logger } from '@nestjs/common';
import { NotificationSender } from './notification-sender';

/**
 * Implementacion de desarrollo: escribe en el log en vez de enviar nada.
 *
 * NotificationsModule se niega a registrarla cuando NODE_ENV=production,
 * porque dejaria los codigos OTP visibles en los logs del servidor. Para una
 * demo desplegada se acepta el riesgo a proposito con
 * NOTIFICATIONS_ALLOW_CONSOLE=true.
 */
@Injectable()
export class ConsoleNotificationSender implements NotificationSender {
  private readonly logger = new Logger('NotificacionesConsola');

  enviarCodigoOtp(telefono: string, codigo: string): Promise<void> {
    this.logger.warn(`[SIMULADO] Codigo OTP para ${telefono}: ${codigo}`);
    return Promise.resolve();
  }

  enviarMensajeCupon(telefono: string, mensaje: string): Promise<void> {
    this.logger.warn(`[SIMULADO] Cupon para ${telefono}: ${mensaje}`);
    return Promise.resolve();
  }
}
