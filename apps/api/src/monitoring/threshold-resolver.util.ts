export interface ThresholdPreferenceRow {
  userId: string;
  serverId: string | null;
  cpuPercent: number | null;
  memoryPercent: number | null;
  temperatureCelsius: number | null;
  dockerScope: string;
  dockerEnabled: boolean;
}

export interface ResolvedThreshold {
  userId: string;
  cpuPercent: number | null;
  memoryPercent: number | null;
  temperatureCelsius: number | null;
  dockerScope: 'all' | 'managed_apps';
  dockerEnabled: boolean;
}

/**
 * Pra cada usuário com alguma preferência (global ou deste servidor), decide
 * qual vale: a específica do servidor tem prioridade sobre a global. Usuário
 * sem nenhuma das duas fica de fora do resultado — sem alerta pra ele, sem
 * exigir configuração prévia obrigatória.
 */
export function resolveThresholdsForServer(rows: ThresholdPreferenceRow[], serverId: string): ResolvedThreshold[] {
  const byUser = new Map<string, ThresholdPreferenceRow>();

  for (const row of rows) {
    if (row.serverId !== serverId && row.serverId !== null) continue;
    const existing = byUser.get(row.userId);
    const isServerSpecific = row.serverId === serverId;
    if (!existing || (existing.serverId === null && isServerSpecific)) {
      byUser.set(row.userId, row);
    }
  }

  return [...byUser.values()].map((row) => ({
    userId: row.userId,
    cpuPercent: row.cpuPercent,
    memoryPercent: row.memoryPercent,
    temperatureCelsius: row.temperatureCelsius,
    dockerScope: row.dockerScope === 'managed_apps' ? 'managed_apps' : 'all',
    dockerEnabled: row.dockerEnabled,
  }));
}
