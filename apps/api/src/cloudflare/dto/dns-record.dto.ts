import { IsBoolean, IsIn, IsInt, IsOptional, IsString } from 'class-validator';

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX'];

export class CreateDnsRecordDto {
  @IsIn(RECORD_TYPES)
  type!: string;

  @IsString()
  name!: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsInt()
  ttl?: number;

  @IsOptional()
  @IsBoolean()
  proxied?: boolean;
}

export class UpdateDnsRecordDto {
  @IsOptional()
  @IsIn(RECORD_TYPES)
  type?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsInt()
  ttl?: number;

  @IsOptional()
  @IsBoolean()
  proxied?: boolean;
}
