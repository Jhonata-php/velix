import { resolve4, resolve6 } from 'dns/promises';

export type DnsState = 'NOT_CONFIGURED' | 'CORRECT' | 'INCORRECT';

export interface DnsCheckResult {
  state: DnsState;
  records: string[];
  expectedIp: string | null;
}

/** Compara os IPs resolvidos com o esperado — função pura, testável sem rede de verdade. */
export function evaluateDnsState(records: string[], expectedIp: string | null): DnsState {
  if (!expectedIp || records.length === 0) return 'NOT_CONFIGURED';
  return records.includes(expectedIp) ? 'CORRECT' : 'INCORRECT';
}

/** Resolução DNS real (A + AAAA) — sem biblioteca nova, `dns/promises` é built-in do Node. */
export async function checkDns(hostname: string, expectedIp: string | null): Promise<DnsCheckResult> {
  const [v4, v6] = await Promise.all([resolve4(hostname).catch(() => [] as string[]), resolve6(hostname).catch(() => [] as string[])]);
  const records = [...v4, ...v6];
  return { state: evaluateDnsState(records, expectedIp), records, expectedIp };
}
