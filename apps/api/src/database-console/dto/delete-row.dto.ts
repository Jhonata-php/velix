import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class DeleteRowDto {
  @IsObject()
  @IsNotEmpty()
  pk!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  database?: string;
}
