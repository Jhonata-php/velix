import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';

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

/** Implanta UM manifesto do catálogo como um serviço novo dentro de um
 * projeto já existente — nome/descrição/ambiente/tags são do projeto
 * (`CreateProjectDto`), não daqui. */
export class DeployServiceDto {
  @IsString()
  manifestSlug!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeployDomainDto)
  domain?: DeployDomainDto;

  /** Valores enviados pelo usuário pras `variables` declaradas no manifesto — chaves
   * desconhecidas são ignoradas por `resolveVariables`, sem precisar validar aqui. */
  @IsOptional()
  variables?: Record<string, string>;

  /** Valor customizado pra um `secret` declarado no manifesto (ex.: senha root
   * digitada em vez de gerada) — chave ausente ou vazia continua gerando
   * automático, chaves desconhecidas são ignoradas por `resolveSecrets`. */
  @IsOptional()
  secrets?: Record<string, string>;

  /** Nomes dos serviços opcionais do manifesto escolhidos na etapa "Componentes" —
   * nomes inválidos são ignorados por `resolveIncludedServices`. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedServices?: string[];
}
