import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { demoLoginActivo, otpSinEnvio } from './auth/auth.service';
import { consolaPermitidaEnProduccion } from './notifications/notifications.module';

/**
 * Origenes que pueden llamar a la API.
 *
 * `CORS_ORIGIN` es una lista separada por comas. Sin la variable se asume
 * desarrollo y se deja pasar a Vite en el 5173: en produccion hay que
 * declararla con el dominio del frontend.
 */
function origenesPermitidos(): string[] {
  const crudo = process.env.CORS_ORIGIN?.trim();
  if (!crudo) return ['http://localhost:5173'];
  return crudo
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const origenes = origenesPermitidos();
  app.enableCors({
    origin: origenes,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const documento = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Rapidix API')
      .setDescription(
        'Backend de Rapidix — SPEC 01.\n\n' +
          'La fuente de verdad funcional es `Rapidix_Especificacion_Funcional.docx`; ' +
          'el prototipo `rapidix_mockup (2).html` lo es de los detalles de implementación.\n\n' +
          '**Autenticación.** El personal entra por `POST /auth/staff/login`. ' +
          'El cliente entra en dos pasos: `POST /auth/cliente/solicitar-codigo` y ' +
          '`POST /auth/cliente/verificar-codigo`. Ambos devuelven un JWT que se envía ' +
          'como `Authorization: Bearer <token>`.\n\n' +
          '**Permisos.** Cada sección de Administración está atada a la matriz de roles ' +
          'del Word 2.4: un rol sin acceso recibe 403.',
      )
      .setVersion('0.1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .build(),
  );
  SwaggerModule.setup('docs', app, documento, {
    swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' },
    customSiteTitle: 'Rapidix API',
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  Logger.log(`Rapidix API escuchando en el puerto ${port}`, 'Bootstrap');
  Logger.log(`Documentación en /docs`, 'Bootstrap');
  Logger.log(`CORS permitido para: ${origenes.join(', ')}`, 'Bootstrap');

  // Que no se queden encendidos sin que nadie se dé cuenta.
  if (demoLoginActivo()) {
    Logger.warn(
      'AUTH_DEMO_LOGIN=true — se entra por rol SIN credenciales, ' +
        'cualquiera puede firmarse un token de ADMINISTRADOR. Solo para pruebas.',
      'Bootstrap',
    );
  }

  if (otpSinEnvio()) {
    Logger.warn(
      'AUTH_OTP_BYPASS=true — el login de cliente NO pide el código: ' +
        'cualquiera que sepa un teléfono entra como ese cliente. Apágalo antes de producción.',
      'Bootstrap',
    );
  }

  if (consolaPermitidaEnProduccion()) {
    Logger.warn(
      'NOTIFICATIONS_ALLOW_CONSOLE=true — no se envía nada por WhatsApp y los ' +
        'códigos OTP quedan escritos en este log: quien lo lea entra como ' +
        'cualquier cliente. Solo para demos.',
      'Bootstrap',
    );
  }
}

void bootstrap();
