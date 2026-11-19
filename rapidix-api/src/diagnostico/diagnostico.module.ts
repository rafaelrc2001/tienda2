import { Module } from '@nestjs/common';
import { DiagnosticoController } from './diagnostico.controller';

/** TEMPORAL: ver DiagnosticoController. */
@Module({
  controllers: [DiagnosticoController],
})
export class DiagnosticoModule {}
