/**
 * Comando remoto de amostragem contínua do watcher: um loop que reamostra
 * CPU (via delta de contadores de /proc/stat entre execuções do próprio
 * loop — sem sleep extra), memória e temperatura a cada 5s, numa única
 * sessão SSH. O cálculo de CPU% em si fica em `computeCpuPercent` (não no
 * shell), pra poder ser testado sem SSH.
 *
 * `temp_unsupported` é uma variável do próprio shell, guardada entre
 * iterações do loop: na primeira vez que `sensors` não devolve nada, para de
 * tentar pelo resto desta sessão SSH — sem gerar erro nem custo repetido num
 * servidor sem lm-sensors (a maioria dos VPS). Reseta sozinho quando a
 * conexão cai e o watcher reconecta (nova sessão, novo shell).
 */
export const MONITORING_SAMPLE_COMMAND = [
  'while true; do',
  '  read -r cpu user nice system idle iowait irq softirq steal rest < /proc/stat',
  "  memtotal=$(awk '/MemTotal/{print $2}' /proc/meminfo)",
  "  memavail=$(awk '/MemAvailable/{print $2}' /proc/meminfo)",
  '  if [ -z "$temp_unsupported" ]; then',
  "    temp=$(sensors -j 2>/dev/null | grep -m1 temp1_input | grep -oE '[0-9]+\\.[0-9]+')",
  '    if [ -z "$temp" ]; then temp_unsupported=1; fi',
  '  else',
  '    temp=""',
  '  fi',
  '  echo "VELIX_SAMPLE cpu_total=$((user+nice+system+idle+iowait+irq+softirq+steal)) cpu_idle=$idle mem_total_kb=$memtotal mem_avail_kb=$memavail temp_c=$temp"',
  '  sleep 5',
  'done',
].join('\n');

export interface RawSample {
  cpuTotal: number;
  cpuIdle: number;
  memTotalKb: number | null;
  memAvailKb: number | null;
  temperatureCelsius: number | null;
}

const FIELD_RE = /(\w+)=(\S*)/g;

export function parseSampleLine(line: string): RawSample | null {
  if (!line.startsWith('VELIX_SAMPLE ')) return null;

  const fields: Record<string, string> = {};
  for (const match of line.matchAll(FIELD_RE)) {
    fields[match[1]] = match[2];
  }

  const cpuTotal = Number(fields.cpu_total);
  const cpuIdle = Number(fields.cpu_idle);
  if (!Number.isFinite(cpuTotal) || !Number.isFinite(cpuIdle)) return null;

  const memTotalKb = Number(fields.mem_total_kb);
  const memAvailKb = Number(fields.mem_avail_kb);
  const temp = fields.temp_c !== '' ? Number(fields.temp_c) : NaN;

  return {
    cpuTotal,
    cpuIdle,
    memTotalKb: Number.isFinite(memTotalKb) ? memTotalKb : null,
    memAvailKb: Number.isFinite(memAvailKb) ? memAvailKb : null,
    temperatureCelsius: Number.isFinite(temp) ? temp : null,
  };
}

/** CPU% precisa de duas amostras (contadores acumulados desde o boot). */
export function computeCpuPercent(prev: RawSample | null, current: RawSample): number | null {
  if (!prev) return null;
  const totalDelta = current.cpuTotal - prev.cpuTotal;
  const idleDelta = current.cpuIdle - prev.cpuIdle;
  if (totalDelta <= 0) return null;
  return Math.round((100 * (totalDelta - idleDelta)) / totalDelta);
}

export function computeMemoryPercent(sample: RawSample): number | null {
  if (sample.memTotalKb === null || sample.memAvailKb === null || sample.memTotalKb === 0) return null;
  return Math.round((100 * (sample.memTotalKb - sample.memAvailKb)) / sample.memTotalKb);
}
