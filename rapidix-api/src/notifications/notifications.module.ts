import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NOTIFICATION_SENDER, NotificationSender } from './notification-sender';
import { ConsoleNotificationSender } from './console-notification-sender';

@Global()
@Module({
  providers: [
    {
      provide: NOTIFICATION_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): NotificationSender => {
        // Cuando exista el proveedor real de WhatsApp se elige aqui segun
        // configuracion. Hoy solo hay uno, y no vale para produccion.
        if (config.get<string>('NODE_ENV') === 'production') {
          throw new Error(
            'No hay proveedor de notificaciones configurado. ConsoleNotificationSender ' +
              'escribe los codigos OTP en el log y no puede usarse en produccion.',
          );
        }
        return new ConsoleNotificationSender();
      },
    },
  ],
  exports: [NOTIFICATION_SENDER],
})
export class NotificationsModule {}
