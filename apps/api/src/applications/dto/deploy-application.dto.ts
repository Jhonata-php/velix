import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches, MinLength, ValidateNested } from 'class-validator';

const APPLICATION_ENVIRONMENTS = ['PRODUCTION', 'STAGING', 'DEVELOPMENT', 'LAB'] as const;

class DeployDomainDto {
  @IsString()
  @Matches(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i, {
    message: 'Informe um domínio válido (ex.: app.seudominio.com)',
  })
  hostname!: string;

  @IsOptional()
  @IsBoolean()
  createDnsRecord?: boolean;
}

export class DeployApplicationDto {
  @IsString()
  manifestSlug!: string;

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

  @IsOptional()
  @ValidateNested()
  @Type(() => DeployDomainDto)
  domain?: DeployDomainDto;

  /** Valores enviados pelo usuário pras `variables` declaradas no manifesto — chaves
   * desconhecidas são ignoradas por `resolveVariables`, sem precisar validar aqui. */
  @IsOptional()
  variables?: Record<string, string>;

  /** Nomes dos serviços opcionais do manifesto escolhidos na etapa "Componentes" —
   * nomes inválidos são ignorados por `resolveIncludedServices`. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedServices?: string[];
}
