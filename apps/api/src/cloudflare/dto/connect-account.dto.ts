import { IsString, MinLength } from 'class-validator';

export class ConnectAccountDto {
  @IsString()
  @MinLength(10)
  apiToken!: string;
}
