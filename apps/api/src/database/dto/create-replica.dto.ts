import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class CreateReplicaDto {
  @IsString()
  targetServerId!: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'Use apenas letras minúsculas, números e hífen' })
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;
}
