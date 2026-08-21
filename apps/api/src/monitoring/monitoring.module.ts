import { Module } from '@nestjs/common';
import { ServersModule } from '../servers/servers.module';
import { PushModule } from '../push/push.module';
import { ApplicationsModule } from '../applications/applications.module';
import { MonitoringService } from './monitoring.service';
import { ThresholdAlertService } from './threshold-alert.service';

@Module({
  imports: [ServersModule, PushModule, ApplicationsModule],
  providers: [MonitoringService, ThresholdAlertService],
})
export class MonitoringModule {}
