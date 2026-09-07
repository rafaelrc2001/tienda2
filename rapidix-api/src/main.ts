import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

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
}

void bootstrap();
