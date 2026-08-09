import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class SetBackupConfigDto {
  /** "HH:mm", ou omitido/null pra desligar o agendamento automático. */
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'Horário inválido (use HH:mm, ex.: 03:15)' })
  scheduledAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  retentionDays?: number;

  @IsOptional()
  @IsString()
  destinationId?: string | null;
}
