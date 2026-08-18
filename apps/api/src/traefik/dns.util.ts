import { resolve4, resolve6 } from 'dns/promises';

export type DnsState = 'NOT_CONFIGURED' | 'CORRECT' | 'INCORRECT';

export interface DnsCheckResult {
  state: DnsState;
  records: string[];
  expectedIp: string | null;
}

/** Faixas oficiais da Cloudflare (https://www.cloudflare.com/ips/) — mudam
 * raramente, por isso hardcoded em vez de buscadas em runtime. Um domínio
 * com o proxy (nuvem laranja) ligado resolve pra uma dessas, nunca pro IP
 * do servidor de verdade — checar contra elas é o que permite distinguir
 * "proxy de propósito" de "DNS realmente errado", sem depender da flag
 * `Domain.proxied` do banco (que só reflete o que o próprio Velix criou;
 * fica desatualizada se o proxy for ligado/desligado direto na Cloudflare). */
const CLOUDFLARE_IPV4_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

const CLOUDFLARE_IPV6_RANGES = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inIpv4Range(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
}

/** Expande `::` e converte pros 128 bits como BigInt — o bastante pra
 * comparar prefixo, não trata IPv4 embutido (não usado nas faixas da Cloudflare). */
function ipv6ToBigInt(ip: string): bigint {
  const [head, tail] = ip.split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = ip.includes('::') && tail ? tail.split(':').filter(Boolean) : [];
  const parts = ip.includes('::') ? [...headParts, ...Array(8 - headParts.length - tailParts.length).fill('0'), ...tailParts] : ip.split(':');
  return parts.reduce((acc, part) => (acc << 16n) + BigInt(parseInt(part || '0', 16)), 0n);
}

function inIpv6Range(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  const bits = BigInt(bitsStr);
  const mask = bits === 0n ? 0n : (((1n << 128n) - 1n) << (128n - bits)) & ((1n << 128n) - 1n);
  return (ipv6ToBigInt(ip) & mask) === (ipv6ToBigInt(range) & mask);
}

/** Só pra decidir v4 vs v6 — não precisa validar o formato, `resolve4`/`resolve6` já garantem isso. */
function isCloudflareIp(ip: string): boolean {
  if (ip.includes(':')) return CLOUDFLARE_IPV6_RANGES.some((cidr) => inIpv6Range(ip, cidr));
  return CLOUDFLARE_IPV4_RANGES.some((cidr) => inIpv4Range(ip, cidr));
}

/** Compara os IPs resolvidos com o esperado — função pura, testável sem rede de verdade. */
export function evaluateDnsState(records: string[], expectedIp: string | null): DnsState {
  if (!expectedIp || records.length === 0) return 'NOT_CONFIGURED';
  if (records.includes(expectedIp)) return 'CORRECT';
  if (records.some(isCloudflareIp)) return 'CORRECT';
  return 'INCORRECT';
}

/** Resolução DNS real (A + AAAA) — sem biblioteca nova, `dns/promises` é built-in do Node. */
export async function checkDns(hostname: string, expectedIp: string | null): Promise<DnsCheckResult> {
  const [v4, v6] = await Promise.all([resolve4(hostname).catch(() => [] as string[]), resolve6(hostname).catch(() => [] as string[])]);
  const records = [...v4, ...v6];
  return { state: evaluateDnsState(records, expectedIp), records, expectedIp };
}
