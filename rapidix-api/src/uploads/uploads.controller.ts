import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { FirmaSubida, UploadsService } from './uploads.service';
import { FirmarSubidaDto } from './dto/firma.dto';
import { Public } from '../auth/public.decorator';
import { ApiTags, ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';

/** Un ano: el id es un uuid, asi que la URL nunca cambia de contenido. */
const CACHE_SEGUNDOS = 31536000;

@ApiTags('Imágenes')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Devuelve una URL firmada para subir una imagen.
   *
   * Abierto a cualquier usuario autenticado: el administrador sube fotos de
   * producto y el cliente la foto de sus propias recetas (HU-C06). La carpeta
   * esta restringida por el DTO, asi que nadie puede escribir fuera de
   * `productos/` ni `recetas/`.
   *
   * Segun el entorno la URL apunta al bucket S3 o a esta misma API; quien sube
   * hace lo mismo en los dos casos.
   */
  @Post('firma')
  @HttpCode(HttpStatus.OK)
  firmar(@Body() dto: FirmarSubidaDto, @Req() req: Request): Promise<FirmaSubida> {
    return this.uploads.firmar(dto, this.baseUrlApi(req));
  }

  /**
   * Recibe los bytes de una subida local.
   *
   * Publica y con el permiso en la query, como una URL firmada de S3: quien
   * sube no manda Bearer. El cuerpo llega crudo gracias al middleware del
   * modulo, que es por lo que aqui se lee `req.body` en vez de un `@Body()`.
   */
  @Put('local/:id')
  @Public()
  @ApiExcludeEndpoint()
  @HttpCode(HttpStatus.NO_CONTENT)
  async subirLocal(
    @Param('id') id: string,
    @Query('firma') firma: string | undefined,
    @Req() req: Request,
  ): Promise<void> {
    const datos = Buffer.isBuffer(req.body) ? req.body : undefined;
    await this.uploads.guardarLocal(id, firma, req.headers['content-type'], datos);
  }

  /**
   * Sirve una imagen guardada en la base de datos.
   *
   * Publica a proposito: es el `src` de un `<img>`, que no puede mandar el
   * Bearer. Lo mismo valdria para una imagen en un bucket, que tampoco pide
   * credenciales para leerse.
   */
  @Get('local/:id')
  @Public()
  @ApiExcludeEndpoint()
  async servirLocal(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const imagen = await this.uploads.leerLocal(id);
    res.set({
      'Content-Type': imagen.contentType,
      'Content-Length': String(imagen.datos.length),
      'Cache-Control': `public, max-age=${CACHE_SEGUNDOS}, immutable`,
    });
    res.send(imagen.datos);
  }

  /**
   * De donde cuelgan las URL locales.
   *
   * Se deduce de la peticion para que la API funcione en local y en Railway
   * sin configurar nada. Detras de un proxy la cabecera `x-forwarded-proto` es
   * la que sabe que el visitante entro por https. `API_PUBLIC_URL` esta para
   * los despliegues donde ni eso sirve —un dominio propio delante, por
   * ejemplo— y manda sobre lo demas.
   */
  private baseUrlApi(req: Request): string {
    const declarada = this.config.get<string>('API_PUBLIC_URL')?.trim();
    if (declarada) return declarada;

    const protocolo = primeraCabecera(req.headers['x-forwarded-proto']) ?? req.protocol;
    const host = primeraCabecera(req.headers['x-forwarded-host']) ?? req.get('host');
    return `${protocolo}://${host}`;
  }
}

/** Un proxy encadenado deja `a, b`; vale el primero. */
function primeraCabecera(valor: string | string[] | undefined): string | undefined {
  const crudo = Array.isArray(valor) ? valor[0] : valor;
  const primero = crudo?.split(',')[0]?.trim();
  return primero || undefined;
}
