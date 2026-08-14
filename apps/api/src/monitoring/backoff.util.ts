const STEPS_MS = [5_000, 10_000, 30_000, 60_000];

/** Tentativa 1 é a primeira reconexão depois de cair (não a conexão
 * inicial). Teto em 60s pra não deixar de tentar de vez. */
export function nextBackoffMs(attempt: number): number {
  if (attempt <= 0) return STEPS_MS[0];
  const index = Math.min(attempt - 1, STEPS_MS.length - 1);
  return STEPS_MS[index];
}
