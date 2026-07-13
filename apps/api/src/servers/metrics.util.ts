export const METRICS_COMMAND =
  'echo "UPTIME:$(uptime)"; echo "MEM:$(free -m | awk \'/Mem:/ {print $2, $3}\')"; echo "DISK:$(df -h / | awk \'NR==2 {print $2, $3, $5}\')"';

export interface ServerMetrics {
  uptimeText: string | null;
  loadAvg: [number, number, number] | null;
  memTotalMb: number | null;
  memUsedMb: number | null;
  diskTotal: string | null;
  diskUsed: string | null;
  diskPercent: string | null;
}

function line(output: string, prefix: string): string | null {
  const found = output.split('\n').find((l) => l.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

export function parseMetrics(output: string): ServerMetrics {
  const uptimeLine = line(output, 'UPTIME:');
  const memLine = line(output, 'MEM:');
  const diskLine = line(output, 'DISK:');

  const loadMatch = uptimeLine?.match(/load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  const uptimeMatch = uptimeLine?.match(/up\s+(.*?),\s+\d+\s+users?,/);

  const [memTotal, memUsed] = memLine?.split(/\s+/).map(Number) ?? [];
  const [diskTotal, diskUsed, diskPercent] = diskLine?.split(/\s+/) ?? [];

  return {
    uptimeText: uptimeMatch?.[1] ?? uptimeLine ?? null,
    loadAvg: loadMatch ? [Number(loadMatch[1]), Number(loadMatch[2]), Number(loadMatch[3])] : null,
    memTotalMb: Number.isFinite(memTotal) ? memTotal : null,
    memUsedMb: Number.isFinite(memUsed) ? memUsed : null,
    diskTotal: diskTotal ?? null,
    diskUsed: diskUsed ?? null,
    diskPercent: diskPercent ?? null,
  };
}
