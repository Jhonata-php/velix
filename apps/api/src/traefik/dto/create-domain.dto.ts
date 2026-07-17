import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class CreateDomainDto {
  // hostname simples (ex.: app.meudominio.com) — sem esquema nem caminho.
  @IsString()
  @Matches(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i, {
    message: 'Informe um domínio válido (ex.: app.seudominio.com)',
  })
  hostname!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  targetPort!: number;

  @IsOptional()
  @IsBoolean()
  createDnsRecord?: boolean;
}
