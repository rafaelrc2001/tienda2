import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { FirmarSubidaDto, TipoImagen } from './dto/firma.dto';

export interface FirmaSubida {
  /** URL a la que el cliente hace PUT con el archivo. Caduca. */
  urlSubida: string;
  /** URL definitiva a guardar en `imagenUrl`. */
  urlPublica: string;
  /** Clave del objeto en el bucket. */
  clave: string;
  expiraEnSegundos: number;
}

const EXTENSIONES: Record<TipoImagen, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const VIGENCIA_FIRMA_SEGUNDOS = 300;

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private cliente: S3Client | null = null;

  constructor(private readonly config: ConfigService) {}

  /**
   * El backend nunca recibe el archivo: firma una URL y el navegador sube
   * directo al bucket. Asi una foto de 5 MB no atraviesa el servidor ni ocupa
   * memoria del contenedor de Railway.
   */
  async firmar(dto: FirmarSubidaDto): Promise<FirmaSubida> {
    const { bucket, publicBaseUrl } = this.leerConfiguracion();
    const clave = `${dto.carpeta}/${randomUUID()}.${EXTENSIONES[dto.contentType]}`;

    const urlSubida = await getSignedUrl(
      this.obtenerCliente(),
      new PutObjectCommand({
        Bucket: bucket,
        Key: clave,
        ContentType: dto.contentType,
      }),
      { expiresIn: VIGENCIA_FIRMA_SEGUNDOS },
    );

    return {
      urlSubida,
      urlPublica: `${publicBaseUrl.replace(/\/$/, '')}/${clave}`,
      clave,
      expiraEnSegundos: VIGENCIA_FIRMA_SEGUNDOS,
    };
  }

  /**
   * La configuracion se lee en cada llamada, no al arrancar: sin S3 la API
   * sigue levantando y solo falla el endpoint de subida, con un mensaje que
   * dice que falta.
   */
  private leerConfiguracion(): {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    publicBaseUrl: string;
  } {
    const valores = {
      endpoint: this.config.get<string>('S3_ENDPOINT'),
      region: this.config.get<string>('S3_REGION') ?? 'auto',
      bucket: this.config.get<string>('S3_BUCKET'),
      accessKeyId: this.config.get<string>('S3_ACCESS_KEY_ID'),
      secretAccessKey: this.config.get<string>('S3_SECRET_ACCESS_KEY'),
      publicBaseUrl: this.config.get<string>('S3_PUBLIC_BASE_URL'),
    };

    const faltantes = Object.entries(valores)
      .filter(([, valor]) => !valor)
      .map(([clave]) => `S3_${clave.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`);

    if (faltantes.length > 0) {
      this.logger.error(`Almacenamiento de imágenes sin configurar: faltan ${faltantes.join(', ')}`);
      throw new ServiceUnavailableException(
        'El almacenamiento de imágenes no está configurado en este entorno.',
      );
    }

    return valores as {
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      publicBaseUrl: string;
    };
  }

  private obtenerCliente(): S3Client {
    if (this.cliente) return this.cliente;
    const cfg = this.leerConfiguracion();
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
