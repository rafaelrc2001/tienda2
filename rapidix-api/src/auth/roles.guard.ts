import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from './roles.decorator';
import { SECCION_KEY } from './seccion.decorator';
import { RolToken } from './jwt-payload';
import { Seccion, tieneAcceso } from './permisos';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const objetivos = [context.getHandler(), context.getClass()];

    const seccion = this.reflector.getAllAndOverride<Seccion>(SECCION_KEY, objetivos);
    const rolesPermitidos = this.reflector.getAllAndOverride<RolToken[]>(ROLES_KEY, objetivos);

    // Sin @RequiereSeccion() ni @Roles() basta con estar autenticado.
    if (!seccion && (!rolesPermitidos || rolesPermitidos.length === 0)) return true;

    const usuario = context.switchToHttp().getRequest<Request>().user;
    if (!usuario) {
      throw new ForbiddenException('Tu rol no tiene acceso a esta sección');
    }

    // @RequiereSeccion consulta la matriz; @Roles restringe a mano cuando la
    // ruta no corresponde a ninguna seccion del panel.
    const permitido = seccion
      ? tieneAcceso(usuario.rol, seccion)
      : rolesPermitidos.includes(usuario.rol);

    if (!permitido) {
      throw new ForbiddenException('Tu rol no tiene acceso a esta sección');
    }
    return true;
  }
}
