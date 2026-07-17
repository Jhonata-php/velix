import { IsEmail, IsOptional } from 'class-validator';

export class InstallTraefikDto {
  // E-mail usado no registro do Let's Encrypt (avisos de expiração). Opcional —
  // o serviço usa um padrão se não informado.
  @IsOptional()
  @IsEmail()
  acmeEmail?: string;
}
