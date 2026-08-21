export const METRICS_COMMAND =
  'echo "UPTIME:$(uptime)"; ' +
  'echo "MEM:$(free -m | awk \'/Mem:/ {print $2, $3}\')"; ' +
  'echo "DISK:$(df -h / | awk \'NR==2 {print $2, $3, $5}\')"; ' +
  'read -r _ a1 b1 c1 d1 e1 f1 g1 h1 _ < /proc/stat; sleep 1; read -r _ a2 b2 c2 d2 e2 f2 g2 h2 _ < /proc/stat; ' +
  't1=$((a1+b1+c1+d1+e1+f1+g1+h1)); t2=$((a2+b2+c2+d2+e2+f2+g2+h2)); dt=$((t2-t1)); di=$((d2-d1)); ' +
  'if [ "$dt" -gt 0 ]; then echo "CPU:$(( (100*(dt-di))/dt ))"; else echo "CPU:"; fi; ' +
  'echo "TEMP:$(sensors -j 2>/dev/null | grep -m1 temp1_input | grep -oE \'[0-9]+\\.[0-9]+\')"; ' +
  // Mesma conexão SSH da coleta de métrica de sempre, sem round-trip extra —
  // antes só vinha de "Testar conexão" (comando isolado), que ninguém repete
  // depois de cadastrar o servidor; card "Sistema operacional" ficava em "—"
  // pra sempre em qualquer servidor cadastrado antes desse recurso existir.
  'echo "OSNAME:$(grep -m1 \'^ID=\' /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d \'"\')"; ' +
  'echo "OSVERSION:$(grep -m1 \'^VERSION_ID=\' /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d \'"\')"';

export interface ServerMetrics {
  uptimeText: string | null;
  loadAvg: [number, number, number] | null;
  memTotalMb: number | null;
  memUsedMb: number | null;
  diskTotal: string | null;
  diskUsed: string | null;
  diskPercent: string | null;
  cpuPercent: number | null;
  temperatureCelsius: number | null;
}

function line(output: string, prefix: string): string | null {
  const found = output.split('\n').find((l) => l.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

export function parseMetrics(output: string): ServerMetrics {
  const uptimeLine = line(output, 'UPTIME:');
  const memLine = line(output, 'MEM:');
  const diskLine = line(output, 'DISK:');
  const cpuLine = line(output, 'CPU:');
  const tempLine = line(output, 'TEMP:');

  const loadMatch = uptimeLine?.match(/load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  const uptimeMatch = uptimeLine?.match(/up\s+(.*?),\s+\d+\s+users?,/);

  const [memTotal, memUsed] = memLine?.split(/\s+/).map(Number) ?? [];
  const [diskTotal, diskUsed, diskPercent] = diskLine?.split(/\s+/) ?? [];

  const cpuPercent = cpuLine ? Number(cpuLine) : NaN;
  const temperatureCelsius = tempLine ? Number(tempLine) : NaN;

  return {
    uptimeText: uptimeMatch?.[1] ?? uptimeLine ?? null,
    loadAvg: loadMatch ? [Number(loadMatch[1]), Number(loadMatch[2]), Number(loadMatch[3])] : null,
    memTotalMb: Number.isFinite(memTotal) ? memTotal : null,
    memUsedMb: Number.isFinite(memUsed) ? memUsed : null,
    diskTotal: diskTotal ?? null,
    diskUsed: diskUsed ?? null,
    diskPercent: diskPercent ?? null,
    cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : null,
    temperatureCelsius: Number.isFinite(temperatureCelsius) ? temperatureCelsius : null,
  };
}

export interface ServerOsInfo {
  osName: string | null;
  osVersion: string | null;
}

/** Mesma extração de `ServersService.testConnection`, mas a partir da saída
 * combinada de `METRICS_COMMAND` — linha vazia (servidor sem `/etc/os-release`,
 * raro fora de distro Linux padrão) vira `null`, não string vazia. */
export function parseOsInfo(output: string): ServerOsInfo {
  const osName = line(output, 'OSNAME:');
  const osVersion = line(output, 'OSVERSION:');
  return { osName: osName || null, osVersion: osVersion || null };
}
