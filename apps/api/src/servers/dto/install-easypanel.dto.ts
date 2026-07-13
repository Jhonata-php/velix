import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class InstallEasyPanelDto {
  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsBoolean()
  createDnsRecord?: boolean;
}
