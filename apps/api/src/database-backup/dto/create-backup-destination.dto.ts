import { IsIn, IsInt, IsOptional, IsString, Max, MinLength, Min } from 'class-validator';

export class CreateBackupDestinationDto {
  @IsString()
  @MinLength(2)
  label!: string;

  @IsIn(['ftp', 'sftp'])
  protocol!: 'ftp' | 'sftp';

  @IsString()
  @MinLength(1)
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsString()
  @MinLength(1)
  username!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsOptional()
  @IsString()
  remotePath?: string;
}
