import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Salud')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): { status: string; uptime: number; timestamp: string } {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
