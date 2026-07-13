import { IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';

export class CreateServerDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  publicIp?: string;

  @IsOptional()
  @IsString()
  privateIp?: string;

  @IsOptional()
  @IsString()
  hostname?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  sshPort: number = 22;

  @IsString()
  sshUser!: string;

  @IsIn(['PASSWORD', 'PRIVATE_KEY'])
  authMethod!: 'PASSWORD' | 'PRIVATE_KEY';

  @ValidateIf((o) => o.authMethod === 'PASSWORD')
  @IsString()
  password?: string;

  @ValidateIf((o) => o.authMethod === 'PRIVATE_KEY')
  @IsString()
  privateKey?: string;

  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  tags?: string[];
}
