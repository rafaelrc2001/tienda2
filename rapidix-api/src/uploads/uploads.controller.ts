import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { FirmaSubida, UploadsService } from './uploads.service';
import { FirmarSubidaDto } from './dto/firma.dto';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Imágenes')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /**
   * Devuelve una URL firmada para subir una imagen.
   *
   * Abierto a cualquier usuario autenticado: el administrador sube fotos de
   * producto y el cliente la foto de sus propias recetas (HU-C06). La carpeta
   * esta restringida por el DTO, asi que nadie puede escribir fuera de
   * `productos/` ni `recetas/`.
   */
  @Post('firma')
  @HttpCode(HttpStatus.OK)
  firmar(@Body() dto: FirmarSubidaDto): Promise<FirmaSubida> {
    return this.uploads.firmar(dto);
  }
}
