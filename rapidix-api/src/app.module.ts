import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { CatalogoModule } from './catalogo/catalogo.module';
import { UploadsModule } from './uploads/uploads.module';
import { RecetarioModule } from './recetario/recetario.module';
import { ConfiguracionModule } from './configuracion/configuracion.module';
import { CuponesModule } from './cupones/cupones.module';
import { PedidosModule } from './pedidos/pedidos.module';
import { CashbackModule } from './cashback/cashback.module';
import { ClientesModule } from './clientes/clientes.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    NotificationsModule,
    CuponesModule,
    AuthModule,
    AdminModule,
    CatalogoModule,
    UploadsModule,
    RecetarioModule,
    ConfiguracionModule,
    CashbackModule,
    ClientesModule,
    PedidosModule,
    HealthModule,
  ],
  providers: [
    // Todo cerrado por defecto: una ruta es publica solo si lleva @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
