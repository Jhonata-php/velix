import { IsNotEmpty, IsString } from 'class-validator';

export class RunQueryDto {
  @IsString()
  @IsNotEmpty()
  sql!: string;
}
