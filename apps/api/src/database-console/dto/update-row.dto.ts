import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateRowDto {
  @IsObject()
  @IsNotEmpty()
  pk!: Record<string, unknown>;

  @IsObject()
  @IsNotEmpty()
  changes!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  database?: string;
}
