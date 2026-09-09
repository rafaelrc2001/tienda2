import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  ParseFilePipeBuilder,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportacionService, ResumenImportacion } from './importacion.service';
import { RequiereSeccion } from '../auth/seccion.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

const TAMANO_MAXIMO_BYTES = 5 * 1024 * 1024;
const TIPOS_XLSX = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

@ApiTags('Administración · Productos')
@ApiBearerAuth()
@Controller('admin/productos')
@RequiereSeccion('productos')
export class AdminImportacionController {
  constructor(private readonly importacion: ImportacionService) {}

  /**
   * Carga masiva desde Excel (HU-A01).
   *
   * El archivo se procesa en memoria y no se guarda: lo que persiste son los
   * productos, no el .xlsx.
   */
  @Post('importar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: TAMANO_MAXIMO_BYTES } }))
  importar(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: TAMANO_MAXIMO_BYTES, message: 'El archivo supera los 5 MB' })
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST, fileIsRequired: true }),
    )
    archivo: Express.Multer.File,
  ): Promise<ResumenImportacion> {
    if (!TIPOS_XLSX.includes(archivo.mimetype) && !archivo.originalname.endsWith('.xlsx')) {
      throw new BadRequestException('El archivo debe ser un .xlsx');
    }
    return this.importacion.importar(archivo.buffer);
  }

  /** Plantilla de ejemplo con las columnas correctas (Word 6.6). */
  @Get('plantilla')
  @Header('Content-Type', TIPOS_XLSX[0])
  @Header('Content-Disposition', 'attachment; filename="plantilla-productos.xlsx"')
  async plantilla(): Promise<StreamableFile> {
    return new StreamableFile(await ImportacionService.generarPlantillaXlsx());
  }
}
