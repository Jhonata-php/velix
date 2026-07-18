/** Compara duas versões SemVer (X.Y.Z[-prerelease]). Retorna >0 se a>b, <0 se a<b, 0 se iguais. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const [main, pre] = v.replace(/^v/i, '').split('-', 2);
    const parts = main.split('.').map((n) => parseInt(n, 10) || 0);
    return { parts, pre };
  };
  const pa = parse(a);
  const pb = parse(b);

  for (let i = 0; i < 3; i++) {
    const diff = (pa.parts[i] ?? 0) - (pb.parts[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  // Sem prerelease > com prerelease (1.0.0 > 1.0.0-beta)
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && pb.pre) return pa.pre.localeCompare(pb.pre);
  return 0;
}
