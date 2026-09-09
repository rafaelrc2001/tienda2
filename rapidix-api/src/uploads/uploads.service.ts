import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Carpeta, FirmarSubidaDto, TAMANO_MAXIMO_BYTES, TipoImagen } from './dto/firma.dto';

export interface FirmaSubida {
  /** URL a la que el cliente hace PUT con el archivo. Caduca. */
  urlSubida: string;
  /** URL definitiva a guardar en `imagenUrl`. */
  urlPublica: string;
  /** Clave del objeto en el bucket, o el id de la fila si se guarda local. */
  clave: string;
  expiraEnSegundos: number;
  /** Donde acabara el archivo. Informativo: el cliente sube igual en ambos casos. */
  destino: 'S3' | 'LOCAL';
}

/** Imagen local lista para escribir en la respuesta. */
export interface ImagenLocal {
  contentType: string;
  datos: Buffer;
}

const EXTENSIONES: Record<TipoImagen, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const VIGENCIA_FIRMA_SEGUNDOS = 300;

/** Lo que va dentro del token de una subida local. */
interface PermisoSubidaLocal {
  /** Id de la fila que se va a escribir. */
  sub: string;
  carpeta: Carpeta;
  contentType: TipoImagen;
}

interface ConfiguracionS3 {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private cliente: S3Client | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Devuelve a donde hay que subir el archivo.
   *
   * Con S3 configurado el backend nunca recibe el archivo: firma una URL y el
   * navegador sube directo al bucket, asi una foto de 5 MB no atraviesa el
   * servidor. Sin S3 se firma una URL de la propia API, que guarda los bytes
   * en la base de datos. El cliente hace lo mismo en los dos casos —un PUT a
   * `urlSubida` y guardar `urlPublica`—, que es justo lo que evita que la
   * pantalla tenga que saber cual de los dos almacenes hay detras.
   */
  async firmar(dto: FirmarSubidaDto, baseUrlApi: string): Promise<FirmaSubida> {
    const s3 = this.leerConfiguracionS3();
    return s3 ? this.firmarEnS3(dto, s3) : this.firmarEnLocal(dto, baseUrlApi);
  }

  private async firmarEnS3(dto: FirmarSubidaDto, cfg: ConfiguracionS3): Promise<FirmaSubida> {
    const clave = `${dto.carpeta}/${randomUUID()}.${EXTENSIONES[dto.contentType]}`;

    const urlSubida = await getSignedUrl(
      this.obtenerCliente(cfg),
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: clave,
        ContentType: dto.contentType,
      }),
      { expiresIn: VIGENCIA_FIRMA_SEGUNDOS },
    );

    return {
      urlSubida,
      urlPublica: `${cfg.publicBaseUrl.replace(/\/$/, '')}/${clave}`,
      clave,
      expiraEnSegundos: VIGENCIA_FIRMA_SEGUNDOS,
      destino: 'S3',
    };
  }

  /**
   * La fila no se crea aqui: el id viaja firmado dentro del token y la escribe
   * el PUT. Si el usuario elige un archivo y luego cancela el formulario, no
   * queda una fila vacia en la tabla.
   */
  private async firmarEnLocal(dto: FirmarSubidaDto, baseUrlApi: string): Promise<FirmaSubida> {
    const id = randomUUID();
    const permiso: PermisoSubidaLocal = {
      sub: id,
      carpeta: dto.carpeta,
      contentType: dto.contentType,
    };
    const token = await this.jwt.signAsync(permiso, { expiresIn: VIGENCIA_FIRMA_SEGUNDOS });

    const base = `${baseUrlApi.replace(/\/$/, '')}/uploads/local/${id}`;
    return {
      urlSubida: `${base}?firma=${encodeURIComponent(token)}`,
      urlPublica: base,
      clave: id,
      expiraEnSegundos: VIGENCIA_FIRMA_SEGUNDOS,
      destino: 'LOCAL',
    };
  }

  /**
   * Escribe los bytes que llegan por PUT.
   *
   * La ruta es publica —el `<img>` y el PUT no llevan Bearer, igual que con
   * S3—, asi que el permiso es el token de la firma: sin el, o pasados los
   * cinco minutos, no se escribe nada. El id va dentro del token, de modo que
   * una firma no sirve para sobreescribir otra imagen.
   */
  async guardarLocal(
    id: string,
    firma: string | undefined,
    contentType: string | undefined,
    datos: Buffer | undefined,
  ): Promise<void> {
    const permiso = await this.verificarFirma(firma);

    if (permiso.sub !== id) {
      throw new UnauthorizedException('La firma no corresponde a esta imagen.');
    }
    // El tipo se fija en la firma y no en la cabecera, para que el archivo que
    // se guarda sea el que se autorizo.
    if (this.normalizarTipo(contentType) !== permiso.contentType) {
      throw new BadRequestException('El tipo del archivo no coincide con el de la firma.');
    }
    if (!datos || datos.length === 0) {
      throw new BadRequestException('No llegó ningún archivo.');
    }
    if (datos.length > TAMANO_MAXIMO_BYTES) {
      throw new PayloadTooLargeException('La imagen no puede pesar más de 5 MB.');
    }

    // Prisma pide un `Uint8Array` con su propio ArrayBuffer; el Buffer que
    // deja el parser puede ser una ventana sobre uno compartido.
    const contenido = {
      carpeta: permiso.carpeta,
      contentType: permiso.contentType,
      tamanoBytes: datos.length,
      datos: new Uint8Array(datos),
    };

    // Upsert y no create: si el navegador reintenta el PUT —una red que se
    // corta a medias— el segundo intento tiene que sobreescribir, no fallar
    // por clave repetida. Es lo mismo que hace S3 al escribir dos veces sobre
    // la misma clave, y el id solo lo conoce quien tiene la firma.
    await this.prisma.imagen.upsert({
      where: { id },
      create: { id, ...contenido },
      update: contenido,
    });
  }

  /** Los bytes que sirve `GET /uploads/local/:id`. */
  async leerLocal(id: string): Promise<ImagenLocal> {
    const imagen = await this.prisma.imagen.findUnique({
      where: { id },
      select: { contentType: true, datos: true },
    });
    if (!imagen) {
      throw new NotFoundException('No encontramos esa imagen.');
    }
    return { contentType: imagen.contentType, datos: Buffer.from(imagen.datos) };
  }

  private async verificarFirma(firma: string | undefined): Promise<PermisoSubidaLocal> {
    if (!firma) {
      throw new UnauthorizedException('Falta la firma de la subida.');
    }
    try {
      return await this.jwt.verifyAsync<PermisoSubidaLocal>(firma);
    } catch {
      // Caducada o manipulada: en los dos casos hay que volver a pedir firma.
      throw new UnauthorizedException('La firma de la subida caducó. Inténtalo de nuevo.');
    }
  }

  /** `image/png; charset=binary` y `image/png` son el mismo tipo. */
  private normalizarTipo(contentType: string | undefined): string {
    return (contentType ?? '').split(';')[0].trim().toLowerCase();
  }

  /**
   * Configuracion de S3, o `null` si el entorno no la tiene completa.
   *
   * Se lee en cada llamada, no al arrancar, para que cambiar las variables no
   * obligue a tocar el codigo. Una configuracion a medias cuenta como ausente:
   * es mas util caer al almacen local que fallar cada subida.
   */
  private leerConfiguracionS3(): ConfiguracionS3 | null {
    const valores = {
      endpoint: this.config.get<string>('S3_ENDPOINT'),
      region: this.config.get<string>('S3_REGION') ?? 'auto',
      bucket: this.config.get<string>('S3_BUCKET'),
      accessKeyId: this.config.get<string>('S3_ACCESS_KEY_ID'),
      secretAccessKey: this.config.get<string>('S3_SECRET_ACCESS_KEY'),
      publicBaseUrl: this.config.get<string>('S3_PUBLIC_BASE_URL'),
    };

    const faltantes = Object.entries(valores)
      .filter(([, valor]) => !valor?.trim())
      .map(([clave]) => clave);

    if (faltantes.length === 0) return valores as ConfiguracionS3;

    // Todas vacias es el caso normal de un entorno sin bucket; unas si y otras
    // no suele ser un despliegue a medio configurar y conviene verlo en el log.
    if (faltantes.length < Object.keys(valores).length) {
      this.logger.warn(
        `S3 configurado a medias (faltan ${faltantes.join(', ')}): ` +
          'las imágenes se guardarán en la base de datos.',
      );
    }
    return null;
  }

  private obtenerCliente(cfg: ConfiguracionS3): S3Client {
    if (this.cliente) return this.cliente;
    this.cliente = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // R2 y la mayoria de compatibles no soportan el estilo virtual-host.
      forcePathStyle: true,
    });
    return this.cliente;
  }
}
