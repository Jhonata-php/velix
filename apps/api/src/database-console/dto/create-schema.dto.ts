import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CreateSchemaDto {
  @IsString()
  @IsNotEmpty()
  // Mesma restrição de identificador que qualquer nome de tabela/coluna já
  // segue neste console — evita depender só do escape de identificador pra
  // barrar um nome absurdo logo na entrada.
  @Matches(/^[a-zA-Z_][a-zA-Z0-9_]*$/, { message: 'Nome inválido — use letras, números e sublinhado, sem começar com número.' })
  name!: string;
}
