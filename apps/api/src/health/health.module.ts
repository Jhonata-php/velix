import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { VersionModule } from '../version/version.module';

@Module({
  imports: [VersionModule],
  controllers: [HealthController],
})
export class HealthModule {}
