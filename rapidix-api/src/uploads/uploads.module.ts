import {
  MiddlewareConsumer,
  Module,
  NestModule,
  PayloadTooLargeException,
  RequestMethod,
} from '@nestjs/common';
import { raw } from 'express';
import type { RequestHandler } from 'express';
import { UploadsService } from './uploads.service';
import { UploadsController } from './uploads.controller';
import { TAMANO_MAXIMO_BYTES, TIPOS_PERMITIDOS } from './dto/firma.dto';

/**
 * Margen sobre el tope real.
 *
 * El limite de 5 MB lo aplica el servicio, que puede explicarlo con un 413 y
 * un mensaje en español; este de aqui solo esta para que un cuerpo enorme no
 * se llegue a meter en memoria. Por eso deja pasar un poco mas: los archivos
 * que se pasan por poco tienen que llegar al servicio para que los rechace el.
 */
const TOPE_EN_MEMORIA = TAMANO_MAXIMO_BYTES + 64 * 1024;

/**
 * Deja la imagen cruda en `req.body` como Buffer.
 *
 * Pasado el tope, body-parser corta con un error suyo, en inglés y con otra
 * forma de cuerpo que el resto de la API. Se traduce aquí para que quien suba
 * reciba el mismo 413 que da el servicio cuando el archivo se pasa por poco.
 */
function parsearImagenCruda(): RequestHandler {
  const parser = raw({ type: [...TIPOS_PERMITIDOS], limit: TOPE_EN_MEMORIA });

  return (req, res, siguiente) => {
    parser(req, res, (error: unknown) => {
      if ((error as { type?: string } | null)?.type === 'entity.too.large') {
        siguiente(new PayloadTooLargeException('La imagen no puede pesar más de 5 MB.'));
        return;
      }
      siguiente(error);
    });
  };
}

@Module({
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule implements NestModule {
  /**
   * El PUT de una subida local trae la imagen en crudo, no un formulario ni
   * JSON, asi que ningun parser de los de serie la recoge. Este middleware la
   * deja como Buffer en `req.body` y solo en esa ruta: el resto de la API
   * sigue hablando JSON.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(parsearImagenCruda())
      .forRoutes({ path: 'uploads/local/:id', method: RequestMethod.PUT });
  }
}
