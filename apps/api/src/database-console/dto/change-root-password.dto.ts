import { IsOptional, IsString, MinLength } from 'class-validator';

export class ChangeRootPasswordDto {
  /** Omitido/vazio = gera uma senha aleatória. */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres.' })
  password?: string;
}
