import { RolUsuario } from '@prisma/client';
import { IsIn } from 'class-validator';
import { ROL_CLIENTE, RolToken } from '../jwt-payload';

/** Los cinco modos de acceso del Word 2.4. */
const ROLES: readonly RolToken[] = [ROL_CLIENTE, ...Object.values(RolUsuario)];

export class EntrarDirectoDto {
  @IsIn(ROLES, { message: 'Ese modo de acceso no existe' })
  rol: RolToken;
}
