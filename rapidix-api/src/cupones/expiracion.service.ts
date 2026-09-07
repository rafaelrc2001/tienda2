import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EstadoCupon } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExpiracionService {
  private readonly logger = new Logger(ExpiracionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Marca como EXPIRED los cupones ACTIVE cuya vigencia ya paso.
   *
   * El estado no se deduce al vuelo comparando fechas porque las metricas
   * (Word 4.9.5) cuentan por estado: sin este barrido, un cupon vencido
   * seguiria contando como activo en el panel.
   *
   * La validacion del checkout tambien marca el vencimiento cuando se topa
   * con uno, asi que este job es la red de seguridad para los que nadie
   * intenta usar.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'expirar-cupones' })
  async expirarVencidos(): Promise<{ expirados: number }> {
    const resultado = await this.prisma.cuponEmitido.updateMany({
      where: { status: EstadoCupon.ACTIVE, expiresAt: { lt: new Date() } },
      data: { status: EstadoCupon.EXPIRED },
    });

    if (resultado.count > 0) {
      this.logger.log(`${resultado.count} cupón(es) marcados como vencidos`);
    }
    return { expirados: resultado.count };
  }
}
