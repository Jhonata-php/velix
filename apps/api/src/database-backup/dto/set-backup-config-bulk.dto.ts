import { ArrayMinSize, IsArray, IsString } from 'class-validator';
import { SetBackupConfigDto } from './set-backup-config.dto';

export class SetBackupConfigBulkDto extends SetBackupConfigDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  projectServiceIds!: string[];
}
