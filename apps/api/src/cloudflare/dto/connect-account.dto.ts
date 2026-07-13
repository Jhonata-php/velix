import { Transform } from 'class-transformer';
import { IsString, MinLength } from 'class-validator';

export class ConnectAccountDto {
  @IsString()
  @MinLength(10)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  apiToken!: string;
}
