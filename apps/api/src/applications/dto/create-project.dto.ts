import { IsArray, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

const APPLICATION_ENVIRONMENTS = ['PRODUCTION', 'STAGING', 'DEVELOPMENT', 'LAB'] as const;

/** Cria um projeto vazio — sem SSH, sem Docker, só a linha no banco. Os
 * serviços entram depois, um a um, via `DeployServiceDto`/`DeployFromGitInput`. */
export class CreateProjectDto {
  @IsString()
  serverId!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(APPLICATION_ENVIRONMENTS)
  environment?: (typeof APPLICATION_ENVIRONMENTS)[number];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
