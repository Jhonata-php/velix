/**
 * Formata a saída crua do `uptime` do Linux ("2:08", "3 days, 4:15",
 * "1 day, 0:03") em algo legível — o valor bruto é exatamente o que a
 * ferramenta imprime (ver apps/api/src/servers/metrics.util.ts), então
 * cobre os dois formatos que ela realmente produz: só H:MM (menos de um
 * dia) ou "N day(s), H:MM" (um dia ou mais).
 */
export function formatUptime(raw: string | null | undefined): string {
  if (!raw) return '—';

  const daysMatch = raw.match(/^(\d+)\s+days?,\s*(.+)$/);
  const rest = daysMatch ? daysMatch[2] : raw;
  const days = daysMatch ? Number(daysMatch[1]) : 0;

  const hm = rest.match(/^(\d+):(\d{2})$/);
  if (!hm) return raw;
  const hours = Number(hm[1]);
  const minutes = Number(hm[2]);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} dia${days === 1 ? '' : 's'}`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}min`);

  return parts.join(' ');
}
