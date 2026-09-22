import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from './roles.decorator';
import { SECCION_KEY } from './seccion.decorator';
import { SOLO_PERSONAL_KEY } from './solo-personal.decorator';
import { ROL_CLIENTE, RolToken } from './jwt-payload';
import { Seccion, tieneAcceso } from './permisos';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const objetivos = [context.getHandler(), context.getClass()];

    const secciones = this.reflector.getAllAndOverride<Seccion[]>(SECCION_KEY, objetivos);
    const rolesPermitidos = this.reflector.getAllAndOverride<RolToken[]>(ROLES_KEY, objetivos);
    const soloPersonal = this.reflector.getAllAndOverride<boolean>(SOLO_PERSONAL_KEY, objetivos);

    // Sin @RequiereSeccion(), @Roles() ni @SoloPersonal() basta con estar autenticado.
    if (!secciones && (!rolesPermitidos || rolesPermitidos.length === 0) && !soloPersonal) {
      return true;
    }

    const usuario = context.switchToHttp().getRequest<Request>().user;
    if (!usuario) {
      throw new ForbiddenException('Tu rol no tiene acceso a esta sección');
    }

    // Va antes que la matriz: el cliente puede tener la seccion y aun asi no
    // pasar (ver `@SoloPersonal`).
    if (soloPersonal && usuario.rol === ROL_CLIENTE) {
      throw new ForbiddenException('Tu rol no tiene acceso a esta sección');
    }

    // @RequiereSeccion consulta la matriz; @Roles restringe a mano cuando la
    // ruta no corresponde a ninguna seccion del panel.
    let permitido = true;
    if (secciones) {
      permitido = secciones.some((s) => tieneAcceso(usuario.rol, s));
    } else if (rolesPermitidos && rolesPermitidos.length > 0) {
      permitido = rolesPermitidos.includes(usuario.rol);
    }

    if (!permitido) {
      throw new ForbiddenException('Tu rol no tiene acceso a esta sección');
    }
    return true;
  }
}
