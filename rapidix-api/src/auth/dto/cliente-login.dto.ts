import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SolicitarCodigoDto {
  @IsString()
  @Matches(/^[+\d][\d\s\-()]{6,19}$/, {
    message: 'El número de WhatsApp no tiene un formato válido',
  })
  telefono: string;
}

export class VerificarCodigoDto {
  @IsString()
  @Matches(/^[+\d][\d\s\-()]{6,19}$/, {
    message: 'El número de WhatsApp no tiene un formato válido',
  })
  telefono: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos' })
  codigo: string;

  /**
   * Solo obligatorio la primera vez, cuando el telefono no existe todavia
   * (HU-C03). Si falta, la API responde con el codigo NOMBRE_REQUERIDO y deja
   * el OTP vivo para que el cliente reintente con su nombre.
   */
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'El nombre es demasiado corto' })
  @MaxLength(80)
  nombre?: string;

  /**
   * Codigo de la fuente por la que llego, tomado del enlace rapidix.mx/r/CODIGO.
   * Solo se guarda en el alta: la atribucion es del primer contacto.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  fuenteCodigo?: string;
}
