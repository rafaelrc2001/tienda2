import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CuponesService } from '../cupones/cupones.service';
import { ROL_CLIENTE, UsuarioAutenticado } from '../auth/jwt-payload';

const MENSAJE_BLOQUEO =
  'Haz tu primer pedido para desbloquear el Recetario. ¡Te dejamos un cupón para estrenarte!';

/**
 * El mismo bloqueo para quien todavia no ha comprado, sin prometer un cupon:
 * el suyo ya lo tiene desde que se registro, en su pestana de Cupones.
 */
const MENSAJE_BLOQUEO_PROSPECTO =
  'Haz tu primer pedido para desbloquear el Recetario. Tienes un cupón de bienvenida esperándote.';

const MENSAJE_BLOQUEO_INACTIVO =
  'Hace tiempo que no nos visitas. Realiza un pedido para volver a usar el Recetario; te dejamos un cupón.';

@Injectable()
export class BloqueoInactividadService {
  private readonly logger = new Logger(BloqueoInactividadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cupones: CuponesService,
  ) {}

  /**
   * Bloqueo del Recetario por inactividad (Word 5, regla 11).
   *
   * Tres condiciones, todas necesarias:
   *  - solo en rol Cliente;
   *  - solo al abrir el detalle de una receta, no al mirar la lista;
   *  - el cliente tiene 0 pedidos, o han pasado mas dias que los configurados
   *    en el cupon de INACTIVITY desde su ultima compra.
   *
   * Se desbloquea solo: en cuanto confirma un pedido, `ultimoPedido` se
   * actualiza y esta comprobacion deja de dispararse. No hay que "levantar"
   * el bloqueo en ningun sitio.
   */
  async exigirAcceso(usuario: UsuarioAutenticado): Promise<void> {
    if (usuario.rol !== ROL_CLIENTE) return;

    const cliente = await this.prisma.cliente.findUnique({ where: { id: usuario.sub } });

    // Quien no ha comprado nunca no tiene fila en `clientes`: es el caso de
    // "0 pedidos" del propio bloqueo, asi que se le aplica igual. No se le
    // emite el cupon de inactividad porque ya recibio el de bienvenida al
    // registrarse, y ese es el que tiene que empujarle a comprar.
    if (!cliente) {
      if (!(await this.prisma.prospecto.count({ where: { id: usuario.sub } }))) return;
      throw new HttpException(
        {
          statusCode: HttpStatus.LOCKED,
          code: 'RECETARIO_BLOQUEADO',
          message: MENSAJE_BLOQUEO_PROSPECTO,
          cupon: null,
        },
        HttpStatus.LOCKED,
      );
    }

    // El mismo metodo decide si esta inactivo y emite el cupon si toca, para
    // que la regla viva en un unico sitio.
    const { inactivo, cupon } = await this.cupones.maybeIssueInactivity(cliente);
    if (!inactivo) return;

    if (cupon) {
      this.logger.log(`Recetario bloqueado para ${cliente.id}; cupón ${cupon.code} emitido`);
    }

    throw new HttpException(
      {
        statusCode: HttpStatus.LOCKED,
        code: 'RECETARIO_BLOQUEADO',
        message: cliente.pedidos === 0 ? MENSAJE_BLOQUEO : MENSAJE_BLOQUEO_INACTIVO,
        cupon: cupon
          ? {
              code: cupon.code,
              titulo: cupon.title,
              mensaje: cupon.customerMessage,
              expiresAt: cupon.expiresAt.toISOString(),
            }
          : null,
      },
      HttpStatus.LOCKED,
    );
  }
}
