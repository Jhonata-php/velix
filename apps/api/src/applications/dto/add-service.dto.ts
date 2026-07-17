import { IsString, MinLength } from 'class-validator';

export class AddServiceDto {
  @IsString()
  @MinLength(1)
  serviceName!: string;
}
