import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RunQueryDto {
  @IsString()
  @IsNotEmpty()
  sql!: string;

  /** Roda contra outro banco/schema da mesma instância — sem isso, usa o
   * DATABASE_NAME padrão da implantação. */
  @IsOptional()
  @IsString()
  database?: string;
}
