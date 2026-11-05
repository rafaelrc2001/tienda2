import { RolUsuario } from '@prisma/client';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class StaffLoginDto {
  /** Nombre de usuario; las cuentas de antes entran con su email. */
  @IsString()
  @MinLength(1, { message: 'Escribe tu usuario' })
  usuario: string;

  /**
   * Sin largo minimo aqui: la politica de contrasenas se aplica al darla de
   * alta. Al entrar solo se compara.
   */
  @IsString()
  @MinLength(1, { message: 'Escribe tu contraseña' })
  password: string;

  /**
   * La tarjeta por la que entro (Ruta, Finanzas...). Si viene y la cuenta es
   * de otro rol se rechaza, para que nadie crea estar en un modo y este en
   * otro.
   */
  @IsOptional()
  @IsIn(Object.values(RolUsuario), { message: 'Ese modo de acceso no existe' })
  rol?: RolUsuario;
}
