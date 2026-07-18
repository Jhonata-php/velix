// Mesmas regras de prisma/password-policy.js (usado pelo seed.js e por
// scripts/reset-admin-password.js). Duplicado aqui de propósito: um require()
// relativo de dist/ pra prisma/ é frágil, e são ~10 linhas — copiar é mais
// simples e mais robusto do que tentar compartilhar entre JS solto e TS compilado.
const WEAK_PASSWORDS = new Set(['changeme123', 'password', 'admin123', '12345678', 'senha123', 'velix1234', 'administrador']);

/** Retorna uma mensagem de erro, ou null se a senha for aceitável. */
export function validatePassword(password: string, email?: string | null): string | null {
  if (!password || password.length < 12) return 'A senha precisa ter pelo menos 12 caracteres.';
  if (WEAK_PASSWORDS.has(password.toLowerCase())) return 'Esta senha é conhecida/fraca demais.';
  if (email && password.toLowerCase() === email.toLowerCase()) return 'A senha não pode ser igual ao e-mail.';
  if (/^\d+$/.test(password)) return 'A senha não pode ser só números.';
  return null;
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Muito fraca' | 'Fraca' | 'Razoável' | 'Forte' | 'Muito forte';
}

/** Indicador visual de força — não é a validação (essa é validatePassword), é
 * só feedback incremental enquanto o usuário digita no formulário. */
export function passwordStrength(password: string): PasswordStrength {
  let score = 0;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  const clamped = Math.min(4, Math.max(0, score - 1)) as 0 | 1 | 2 | 3 | 4;
  const labels: PasswordStrength['label'][] = ['Muito fraca', 'Fraca', 'Razoável', 'Forte', 'Muito forte'];
  return { score: clamped, label: labels[clamped] };
}
