import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateServerDto {
  @IsOptional()
  @IsString()
  name?: string;

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

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  sshPort?: number;

  @IsOptional()
  @IsString()
  sshUser?: string;

  @IsOptional()
  @IsIn(['PASSWORD', 'PRIVATE_KEY'])
  authMethod?: 'PASSWORD' | 'PRIVATE_KEY';

  // Só reescreve a credencial se vier preenchida — permite editar o resto sem re-digitar senha/chave.
  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  privateKey?: string;
}
