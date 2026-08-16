import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class CreateApplicationDomainDto {
  @IsString()
  @Matches(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i, {
    message: 'Informe um domínio válido (ex.: app.seudominio.com)',
  })
  hostname!: string;

  @IsString()
  serviceName!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsOptional()
  @IsBoolean()
  createDnsRecord?: boolean;

  /** Proxy da Cloudflare (nuvem laranja) no registro DNS — esconde o IP real
   * e passa o tráfego pela CDN/WAF da Cloudflare. Só faz sentido junto com
   * `createDnsRecord`; ignorado se o registro não for criado por aqui. */
  @IsOptional()
  @IsBoolean()
  proxied?: boolean;
}
