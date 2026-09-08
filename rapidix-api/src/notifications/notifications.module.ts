import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NOTIFICATION_SENDER, NotificationSender } from './notification-sender';
import { ConsoleNotificationSender } from './console-notification-sender';

/**
 * Permite la implementacion de consola aunque NODE_ENV sea production
 * (`NOTIFICATIONS_ALLOW_CONSOLE=true`).
 *
 * Es para desplegar demos mientras WhatsApp esta fuera de alcance (Word 8).
 * Encendido, los codigos OTP quedan escritos en el log del servidor: quien vea
 * los logs puede entrar como cualquier cliente. En produccion de verdad va en
 * false, que es lo que vale si no defines la variable.
 */
export function consolaPermitidaEnProduccion(): boolean {
  return (
    process.env.NOTIFICATIONS_ALLOW_CONSOLE?.trim().toLowerCase() === 'true'
  );
}

@Global()
@Module({
  providers: [
    {
      provide: NOTIFICATION_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): NotificationSender => {
        // Cuando exista el proveedor real de WhatsApp se elige aqui segun
        // configuracion. Hoy solo hay uno, y no vale para produccion salvo
        // que se acepte el riesgo a proposito con NOTIFICATIONS_ALLOW_CONSOLE.
        if (
          config.get<string>('NODE_ENV') === 'production' &&
          !consolaPermitidaEnProduccion()
        ) {
          throw new Error(
            'No hay proveedor de notificaciones configurado. ConsoleNotificationSender ' +
              'escribe los codigos OTP en el log y no puede usarse en produccion. ' +
              'Para una demo, define NOTIFICATIONS_ALLOW_CONSOLE=true a sabiendas.',
          );
        }
        return new ConsoleNotificationSender();
      },
    },
  ],
  exports: [NOTIFICATION_SENDER],
})
export class NotificationsModule {}
