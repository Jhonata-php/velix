import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class UpdateBackupSettingsDto {
  /** "HH:mm" — mesmo padrão de SetBackupConfigDto (backup por banco). */
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'Horário inválido (use HH:mm, ex.: 03:15)' })
  scheduledAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  retentionDays?: number;
}
