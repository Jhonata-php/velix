import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateThresholdDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  cpuPercent?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  memoryPercent?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  temperatureCelsius?: number | null;

  @IsOptional()
  @IsIn(['all', 'managed_apps'])
  dockerScope?: 'all' | 'managed_apps';

  @IsOptional()
  @IsBoolean()
  dockerEnabled?: boolean;
}
