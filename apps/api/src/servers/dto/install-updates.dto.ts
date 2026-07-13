import { IsBoolean, IsOptional } from 'class-validator';

export class InstallUpdatesDto {
  @IsOptional()
  @IsBoolean()
  securityOnly?: boolean;
}
