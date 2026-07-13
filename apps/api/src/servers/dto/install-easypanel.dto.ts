import { IsBoolean, IsEmail, IsOptional, IsString } from 'class-validator';

export class InstallEasyPanelDto {
  @IsOptional()
  @IsString()
  domain?: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsBoolean()
  createDnsRecord?: boolean;
}
