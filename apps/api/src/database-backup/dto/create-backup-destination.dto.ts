import { IsIn, IsInt, IsOptional, IsString, Max, MinLength, Min, ValidateIf } from 'class-validator';

export class CreateBackupDestinationDto {
  @IsString()
  @MinLength(2)
  label!: string;

  @IsIn(['ftp', 'sftp', 's3'])
  protocol!: 'ftp' | 'sftp' | 's3';

  // FTP/SFTP: endereço do servidor (obrigatório). S3: endpoint customizado
  // pra provedores S3-compatíveis (MinIO, R2, B2...) — opcional, vazio usa o
  // endpoint padrão da AWS pra `region`.
  @ValidateIf((o) => o.protocol !== 's3')
  @IsString()
  @MinLength(1)
  host?: string;

  // Sem sentido pra S3 — endpoint (`host`), quando informado, já é uma URL
  // completa e embute a porta se precisar.
  @ValidateIf((o) => o.protocol !== 's3')
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  // FTP/SFTP: usuário. S3: access key id.
  @IsString()
  @MinLength(1)
  username!: string;

  // FTP/SFTP: senha. S3: secret access key.
  @IsString()
  @MinLength(1)
  password!: string;

  @IsOptional()
  @IsString()
  remotePath?: string;

  @ValidateIf((o) => o.protocol === 's3')
  @IsString()
  @MinLength(1)
  bucket?: string;

  @IsOptional()
  @IsString()
  region?: string;
}
