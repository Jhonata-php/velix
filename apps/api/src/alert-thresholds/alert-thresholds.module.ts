import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AlertThresholdsController } from './alert-thresholds.controller';
import { AlertThresholdsService } from './alert-thresholds.service';

@Module({
  imports: [AuthModule],
  controllers: [AlertThresholdsController],
  providers: [AlertThresholdsService],
})
export class AlertThresholdsModule {}
