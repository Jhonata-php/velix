import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  // trim/lowercase antes do @IsEmail rodar — senão "  a@b.com  " falha na
  // validação em vez de ser normalizado (AuthService também normaliza, mas
  // rejeitar aqui um e-mail válido com espaço em volta seria um bug à parte).
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
