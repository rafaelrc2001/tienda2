import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AUTH_OPCIONAL_KEY } from './auth-opcional.decorator';
import { JwtPayload } from './jwt-payload';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const objetivos = [context.getHandler(), context.getClass()];
    const esPublico = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, objetivos);
    const esOpcional = this.reflector.getAllAndOverride<boolean>(AUTH_OPCIONAL_KEY, objetivos);

    // El orden importa: `@AutenticacionOpcional()` tambien deja pasar sin
    // token, pero antes intenta leerlo. Si se comprobara `@Public()` primero,
    // una ruta marcada con las dos nunca sabria quien la esta pidiendo.
    if (esOpcional) {
      const request = context.switchToHttp().getRequest<Request>();
      const token = JwtAuthGuard.extraerToken(request);
      if (token) {
        try {
          request.user = await this.jwt.verifyAsync<JwtPayload>(token);
        } catch {
          // Token viejo o de otro entorno: se sigue como visitante.
        }
      }
      return true;
    }

    if (esPublico) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = JwtAuthGuard.extraerToken(request);
    if (!token) {
      throw new UnauthorizedException('Falta el token de acceso');
    }

    try {
      request.user = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
    return true;
  }

  private static extraerToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) return null;
    const [tipo, valor] = header.split(' ');
    return tipo === 'Bearer' && valor ? valor : null;
  }
}
